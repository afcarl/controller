/* jshint node: true */
'use strict';

var Docker  = require('dockerode');
var url     = require('url');
var _       = require('lodash');
var async   = require('async');
var util    = require('./util');
var service = require('./service');

var DOCKER_PORT = 2375;
var PORT_RANGE  = _.range(8000, 8999);

function dockerCmd() {
  var args = _.toArray(arguments);
  var host = args.shift();
  var cmd = args.shift();
  var docker = new Docker({
    host: 'http://' + host,
    port: DOCKER_PORT,
  });
  return docker[cmd].apply(docker, args);
}

function createContainer(host, createOptions, fn) {
  dockerCmd(host, 'createContainer', createOptions, fn);
}

function createAndStartContainer(host, externalPort, createOptions, fn) {
  async.waterfall([
    function(fn) {
      createContainer(host, createOptions, fn);
    },
    function(container, fn) {
      container.start({
        'PortBindings': {
          '3000/tcp': [{'HostPort': ''+externalPort}]
        }
      }, fn);
    }
  ], fn);
}

function runContainer(host, port, image, envs, fn) {

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

  createAndStartContainer(host, port, createOptions, fn);
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

function pullDockerImage(host, image, fn) {
  // TODO: Pull from external repo (https://docs.docker.com/reference/api/docker_remote_api_v1.12/)
  dockerCmd(host, 'pull', image, fn);
}

function loadContainers(host, fn) {
  dockerCmd(host, 'listContainers', fn);
}

function inspectContainer(host, containerId, fn) {
  var container = dockerCmd(host, 'getContainer', containerId);
  container.inspect(fn);
}

function stopContainer(host, containerId, fn) {
  var container = dockerCmd(host, 'getContainer', containerId);
  container.stop(fn);
}

function stopContainerByPort(host, port, fn) {
  loadContainers(host, function(err, containers) {
    var match = _.find(containers, function(container) {
      return container.Ports[0].PublicPort == port;
    });
    if (match) {
      stopContainer(host, match.Id, fn);
    }
    else {
      fn(null, '');
    }
  });
}

function deployAppInstance(domain, host, port, image, fn) {
  async.waterfall([
    function(fn) {
      console.log('Pulling new tags for ' + image);
      pullDockerImage(host, image, fn);
    },
    function(result, fn) {
      service.loadAppEnvs(domain, fn);
    },
    function(envs, fn) {
      console.log('Starting new container at ' + host + ':' + port);
      runContainer(host, port, image, envs, fn);
    },
    function(container, fn) {
      console.log('Checking host health');
      util.healthCheckHost(host, port, fn);
    },
    function(success, fn) {
      if (!success) {
        fn(new Error('Failed to deploy new instance.'));
      }
      else {
        console.log('Adding ' + host + ':' + port + ' to router');
        service.addAppInstance(domain, host + ':' + port, fn);
      }
    }
  ], fn);
}

function countRunningContainers(host, fn) {
  loadContainers(host, function(err, containers) {
    if (err) {
      return fn(err);
    }
    fn(null, (_.isArray(containers) ? containers.length : 0));
  });
}

function countAllRunningContainers(fn) {
  service.loadHosts(function(err, hosts) {
    if (err) {
      return fn(err);
    }
    async.map(hosts, function(host, fn) {
      countRunningContainers(host, function(err, count) {
        if (err) {
          return fn(err);
        }
        fn(null, [host, count]);
      });
    }, fn);
  });
}

function getLeastUtilizedHosts(max, fn) {
  countAllRunningContainers(function(err, counts) {
    if (err) {
      return fn(err);
    }
    var hosts = _(counts).sortBy(function(t) {
      return t[1];
    }).last(max).pluck(0).value();
    fn(null, hosts);
  });
}

function deployNewAppInstances(domain, image, fn) {
  getLeastUtilizedHosts(2, function(err, hosts) {
    async.map(hosts, function(node, fn) {
      findAvailablePort(node, function(err, port) {
        if (err) {
          return fn(err);
        }
        deployAppInstance(domain, node, port, image, fn);
      });
    }, fn);
  });
}

function tearDownInstance(domain, host, port, fn) {
  console.log('Killing instance at ' + host + ':' + port);
  async.waterfall([
    function(fn) {
      stopContainerByPort(host, port, fn);
    },
    function(result, fn) {
      service.removeAppInstance(domain, host + ':' + port, fn);
    }
  ], fn);
}

function deployAppInstances(domain, image, fn) {
  service.loadAppInstances(domain, function(err, instances) {
    if (err) {
      return fn(err);
    }
    if (instances.length) {
      var cb = fn;
      fn = function() {
        async.map(instances, function(instance, fn) {
          var parts = instance.split(':');
          tearDownInstance(domain, parts[0], parts[1], fn);
        }, cb);
      };
    }
    deployNewAppInstances(domain, image, fn);
  });
}

exports.deployAppInstances = deployAppInstances;
