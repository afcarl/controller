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

function loadAppHosts(domain, fn) {
  redisClient.smembers(domain + ':hosts', fn);
}

function loadAppEnvs(domain, fn) {
  redisClient.smembers(domain + ':envs', fn);
}

function runContainer(hostname, exposedPort, image, envs, fn) {

  var docker = new Docker({
    host: 'http://' + hostname,
    port: DOCKER_PORT,
  });

  var createOptions = {
    'Hostname': '',
    'User': '',
    'AttachStdin': false,
    'AttachStdout': true,
    'AttachStderr': true,
    'Tty': true,
    'OpenStdin': false,
    'StdinOnce': false,
    'Env': envs,
    'Cmd': null,
    'Image': image,
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
        '3000/tcp': [{'HostPort': ''+exposedPort}]
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
  var docker = new Docker({
    host: 'http://' + hostname,
    port: DOCKER_PORT,
  });

  // TODO: Pull from external repo https://docs.docker.com/reference/api/docker_remote_api_v1.12/
  docker.pull(image, fn);
}

function loadContainers(hostname, fn) {
  var docker = new Docker({
    host: 'http://' + hostname,
    port: DOCKER_PORT,
  });
  docker.listContainers(fn);
}

function stopContainer(hostname, containerId, fn) {
  var docker = new Docker({
    host: 'http://' + hostname,
    port: DOCKER_PORT,
  });
  docker.getContainer(containerId).stop(fn);
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
  redisClient.srem(domain + ':hosts', hostname + ':' + port, function(err) {
    if (err) {
      return fn(err);
    }
    fn(null);
  });
}

function healthCheckHost(hostname, port, fn) {
  var healthCheckUrl = 'http://' + hostname + ':' + port + '/ping';
  async.retry(5, function(fn) {
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

function deployAppInstance(hostname, port, image, envs, fn) {

  console.log('Deploying ' + image + ' to ' + hostname + ':' + port);

  async.waterfall([
    function(fn) {
      pullDockerImage(hostname, image, fn);
    },
    function(pullInfo, fn) {
      runContainer(hostname, port, image, envs, fn);
    },
    function(container, fn) {
      healthCheckHost(hostname, port, fn);
    },
  ], fn);
}

function loadContainerByHostnameAndPort(hostname, port, fn) {
  loadContainers(hostname, function(err, containers) {
    var containerId = null;
    containers.forEach(function(container) {
      if (container.Ports[0].PublicPort == port) {
        containerId = container.Id;
      }
    });
    fn(null, containerId);
  });
}

function stopContainerByHostnameAndPort(hostname, port, fn) {
  console.log('Stopping', arguments)
  loadContainerByHostnameAndPort(hostname, port, function(err, containerId) {
    if (err) {
      return fn(err);
    }
    if (containerId) {
      stopContainer(hostname, containerId, fn);
    }
    else {
      fn(null);
    }
  });
}

function replaceAppInstance(domain, host, image, fn) {

  var parts    = host.split(':');
  var hostname = parts[0];
  var port     = parts[1];

  async.parallel({
    port: _.partial(findAvailablePort, hostname),
    envs: _.partial(loadAppEnvs, domain),
  }, function(err, config) {
    if (err) {
      return fn(err);
    }
    async.waterfall([
      function(fn) {
        deployAppInstance(hostname, config.port, image, config.envs, fn);
      },
      function(success, fn) {
        var killPort = success ? port : config.port;
        stopContainerByHostnameAndPort(hostname, killPort, fn);
      },
      function(stopped, fn) {
        addHostToPool(domain, hostname, config.port, fn);
      },
      function(result, fn) {
        removeHostFromPool(domain, hostname, port, fn);
      }
    ], fn);
  });
}

function deployAppInstances(domain, image, fn) {
  loadAppHosts(domain, function(err, hosts) {
    if (err) {
      return fn(err);
    }
    async.map(hosts, function(host, fn) {
      replaceAppInstance(domain, host, image, fn);
    }, fn);
  });
}

app.post('/deploy', function(req, res) {

  var domain = req.body.domain;
  var image  = req.body.image;

  deployAppInstances(domain, image, function(err, result) {
    console.log(err, result);

    if (err) {
      return res.send(500, '');
    }
    res.send(200, 'Host deployed');
  });

});

module.exports = app;
