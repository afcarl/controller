/* jslint node: true */
'use strict';

var express    = require('express');
var async      = require('async');
var request    = require('request');
var bodyParser = require('body-parser');
var validator  = require('express-validator');
var url        = require('url');
var Docker     = require('dockerode');
var redis      = require('redis');
var _          = require('lodash');

var DOCKER_PORT = 2375;
var PORT_RANGE  = _.range(8000, 8999);

var app = express();

app.use(bodyParser());
app.use(validator());

var redisClient = redis.createClient();

function getDockerClient(hostname) {
  return new Docker({
    host: 'http://' + hostname,
    port: DOCKER_PORT,
  });
}

function loadAppHosts(domain, fn) {
  redisClient.smembers(domain + ':hosts', fn);
}

function loadAppEnvs(domain, fn) {
  redisClient.smembers(domain + ':envs', fn);
}

function runContainer(config, fn) {

  var docker = getDockerClient(config.hostname);

  var createOptions = {
    'Hostname': '',
    'User': '',
    'AttachStdin': false,
    'AttachStdout': true,
    'AttachStderr': true,
    'Tty': true,
    'OpenStdin': false,
    'StdinOnce': false,
    'Env': config.envs,
    'Cmd': null,
    'Image': config.image,
    'Volumes': {},
    'VolumesFrom': '',
    'ExposedPorts': {'3000/tcp': {}},
  };

  docker.createContainer(createOptions, function(err, container) {
    if (err) {
      return fn(err);
    }
    container.start({
      'PortBindings': {
        '3000/tcp': [{'HostPort': ''+config.port}]
      }
    }, function(err, data) {
      if (err) {
        return fn(err);
      }
      docker.getContainer(container.id).inspect(fn);
    });
  });
}

function pullDockerImage(hostname, image, fn) {
  // TODO: Pull from external repo (https://docs.docker.com/reference/api/docker_remote_api_v1.12/)
  getDockerClient(hostname).pull(image, fn);
}

function loadContainers(hostname, fn) {
  getDockerClient(hostname).listContainers(fn);
}

function stopContainer(hostname, port, fn) {
  loadContainers(hostname, function(err, containers) {
    var match = _.find(containers, function(container) {
      return container.Ports[0].PublicPort == port;
    });
    if (match) {
      getDockerClient(hostname).getContainer(match.Id).stop(fn);
    }
    else {
      fn(null, null);
    }
  });
}

function loadPortsInUse(hostname, fn) {
  loadContainers(hostname, function(err, containers) {
    if (err) {
      return fn(err);
    }
    var portsInUse = _.map(containers, function(container) {
      return container.Ports[0].PublicPort;
    });
    fn(null, portsInUse);
  });
}

function findAvailablePort(hostname, fn) {
  loadPortsInUse(hostname, function(err, portsInUse) {
    if (err) {
      return fn(err);
    }
    var port = _.sample(_.difference(PORT_RANGE, portsInUse));
    fn(null, port);
  });
}

function addHostToPool(domain, hostname, port, fn) {
  redisClient.sadd(domain + ':hosts', hostname + ':' + port, fn);
}

function removeHostFromPool(domain, hostname, port, fn) {
  redisClient.srem(domain + ':hosts', hostname + ':' + port, fn);
}

function healthCheckHost(hostname, port, fn) {
  var healthCheckUrl = 'http://' + hostname + ':' + port + '/ping';
  async.retry(10, function(fn) {
    setTimeout(function() {
      request(healthCheckUrl, function(err, res) {
        if (err) {
          return fn(err);
        }
        fn(null, res.statusCode == 200);
      });
    }, 3000);
  }, fn);
}

function loadNewInstanceConfig(domain, hostname, image, fn) {
  async.parallel({
    port: _.partial(findAvailablePort, hostname),
    envs: _.partial(loadAppEnvs, domain),
  }, function(err, config) {
    if (err) {
      return fn(err);
    }
    config.image    = image;
    config.hostname = hostname;
    config.domain   = domain;
    fn(null, config);
  });
}

function deployAppInstance(domain, hostname, existingPort, image, fn) {
  loadNewInstanceConfig(domain, hostname, image, function(err, config) {
    if (err) {
      return fn(err);
    }
    async.waterfall([
      function(fn) {
        console.log('Pulling new tags for ' + config.image);
        pullDockerImage(config.hostname, config.image, fn);
      },
      function(pullInfo, fn) {
        console.log('Starting new container at ' + config.hostname + ':' + config.port);
        runContainer(config, fn);
      },
      function(container, fn) {
        console.log('Checking host health');
        healthCheckHost(config.hostname, config.port, fn);
      },
      function(success, fn) {
        if (!success) {
          fn(new Error('Failed to deploy new instance.'));
        }
        else {
          console.log('Adding ' + config.hostname + ':' + config.port + ' to router');
          addHostToPool(config.domain, config.hostname, config.port, fn);
        }
      },
      function(result, fn) {
        console.log('Removing ' + config.hostname + ':' + config.port + ' from router');
        removeHostFromPool(config.domain, config.hostname, existingPort, fn);
      }
    ], function(err, result) {
      if (err) {
        console.log('Deploy error. Rolling back.', err);
        rollbackContainer(config, existingPort, fn);
      }
      else {
        console.log('Stopping previous application container');
        stopContainer(config.hostname, existingPort, fn);
      }
    });
  });
}

function rollbackContainer(config, existingPort, fn) {
  async.series([
    function(fn) {
      addHostToPool(config.domain, config.hostname, existingPort, fn);
    },
    function(fn) {
      removeHostFromPool(config.domain, config.hostname, config.port, fn);
    },
  ], fn);
}

function getHostnameFromHost(host) {
  return host.split(':')[0];
}

function getPortFromHost(host) {
  return host.split(':')[1];
}

function deployAppInstances(domain, image, fn) {
  loadAppHosts(domain, function(err, hosts) {
    if (err) {
      return fn(err);
    }
    async.map(hosts, function(host, fn) {
      var hostname = getHostnameFromHost(host);
      var port = getPortFromHost(host);
      deployAppInstance(domain, hostname, port, image, fn);
    }, fn);
  });
}

app.post('/deploy', function(req, res) {

  var domain = req.body.domain;
  var image  = req.body.image;

  deployAppInstances(domain, image, function(err, result) {
    if (err) {
      return res.send(500, null);
    }
    res.send(200, null);
  });

});

module.exports = app;
