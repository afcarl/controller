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
  redisClient.smembers(domain + ':hosts', function(err, hosts) {
    if (err) {
      return fn(err);
    }
    fn(null, hosts);
  });
}

function loadAppEnvs(domain, fn) {
  redisClient.smembers(domain + ':envs', function(err, envs) {
    if (err) {
      return fn(err);
    }
    fn(null, envs);
  });
}

function runContainer(host, hostPort, image, envs, fn) {

  var docker = new Docker({
    host: 'http://' + host,
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
        '3000/tcp': [{'HostPort': ''+hostPort}]
      }
    }, function(err, data) {
      if (err) {
        return fn(err);
      }
      docker.getContainer(container.id).inspect(fn);
    });
  });
}

function pullDockerImage(host, image, fn) {
  var docker = new Docker({
    host: 'http://' + host,
    port: DOCKER_PORT,
  });

  // TODO: Pull from external repo https://docs.docker.com/reference/api/docker_remote_api_v1.12/
  docker.pull(image, fn);
}

function loadContainers(host, fn) {
  var docker = new Docker({
    host: 'http://' + host,
    port: DOCKER_PORT,
  });
  docker.listContainers(fn);
}

function stopContainer(host, containerId, fn) {
  var docker = new Docker({
    host: 'http://' + host,
    port: DOCKER_PORT,
  });
  docker.getContainer(containerId).stop(fn);
}

function loadPortsInUse(host, fn) {
  loadContainers(host, function(err, containers) {
    if (err) {
      return fn(err);
    }
    var portsInUse = _.map(containers, function(container) {
      return container.Ports[0].PublicPort;
    });
    fn(null, portsInUse);
  });
}

function findAvailablePort(host, fn) {
  loadPortsInUse(host, function(err, portsInUse) {
    if (err) {
      return fn(err);
    }
    var port = _.sample(_.difference(PORT_RANGE, portsInUse));
    fn(null, port);
  });
}

function addHostToPool(domain, host, port, fn) {
  redisClient.sadd(domain + ':hosts', host + ':' + port, fn);
}

function removeHostFromPool(domain, host, port, fn) {
  redisClient.srem(domain + ':hosts', host + ':' + port, function(err) {
    if (err) {
      return fn(err);
    }
    fn(null);
  });
}

function healthCheckHost(host, port, fn) {
  var healthCheckUrl = 'http://' + host + ':' + port + '/ping';
  async.retry(5, function(fn) {
    setTimeout(function() {
      request(healthCheckUrl, function(err, res) {
        console.log(arguments)
        if (err) {
          return fn(err);
        }
        fn(null, res.statusCode == 200);
      });
    }, 3000);
  }, fn);
}

function deployAppInstance(domain, host, port, image, envs, fn) {

  console.log('Deploying app to ' + host + ':' + port);

  async.waterfall([

    function(fn) {
      pullDockerImage(host, image, fn);
    },

    function(pullInfo, fn) {
      runContainer(host, port, image, envs, fn);
    },

    function(container, fn) {
      healthCheckHost(host, port, fn);
    },

    function(healthy, fn) {
      if (!healthy) {
        return fn(new Error('Failed to start new container. Rolling back.'));
      }
      addHostToPool(domain, host, port, fn);
    },

    function(fn) {
      console.log(arguments);
    }

  ], fn);
}

function deployAppInstances(domain, image, fn) {
  async.parallel({
    hosts: _.partial(loadAppHosts, domain),
    envs:  _.partial(loadAppEnvs, domain),
  }, function(err, config) {
    if (err) {
      return fn(err);
    }
    async.map(config.hosts, function(host, fn) {
      findAvailablePort(host, function(err, port) {
        if (err) {
          return fn(err);
        }
        deployAppInstance(domain, host, port, image, config.envs, fn);
      });
    }, fn);
  });
}

app.post('/deploy', function(req, res) {
  var domain = req.body.domain;
  var image  = req.body.image;
  deployAppInstances(domain, image, function(err, result) {
    if (err) {
      return res.send(400, err);
    }
    res.send(204, '');
  });
});

module.exports = app;
