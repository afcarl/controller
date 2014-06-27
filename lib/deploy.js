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
  dockerCmd(host, 'pull', image, function(err, stream) {
    if (err) {
      return fn(err);
    }
    stream.on('data', function(buff) {
      console.log(buff.toString());
    });
    stream.on('end', function() {
      fn();
    });
  });
}

function loadContainers(host, fn) {
  dockerCmd(host, 'listContainers', fn);
}

function loadContainerByHostAndPort(host, port, fn) {
  loadContainers(host, function(err, containers) {
    if (err) {
      return fn(err);
    }
    var match = _.find(containers, function(container) {
      return container.Ports[0].PublicPort == port;
    });
    fn(null, match);
  });
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
  loadContainerByHostAndPort(host, port, function(err, container) {
    if (err) {
      return fn(err);
    }
    if (container) {
      stopContainer(host, container.Id, fn);
    }
    else {
      fn(null, '');
    }
  });
}

function deployAppInstance(app, host, port, image, fn) {
  async.waterfall([
    function(fn) {
      console.log('Pulling new tags for ' + image);
      pullDockerImage(host, image, fn);
    },
    function(fn) {
      service.loadAppEnvs(app, fn);
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
      } else {
        console.log('Adding ' + host + ':' + port + ' to router');
        service.addAppInstance(app, host + ':' + port, fn);
      }
    }
  ], function(err, result) {
    if (err) {
      console.log('Deploy failed. Rolling back.');
      tearDownInstance(app, host, port, function(_err) {
        if (_err) {
          return fn(new Error('Rollback failed. System may be in an invalid state.'));
        }
        fn(new Error('Deployment failed. Rolling back.'));
      });
    } else {
      fn(null);
    }
  });
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

function deployNewAppInstances(app, image, fn) {
  getLeastUtilizedHosts(2, function(err, hosts) {
    async.map(hosts, function(node, fn) {
      findAvailablePort(node, function(err, port) {
        if (err) {
          return fn(err);
        }
        deployAppInstance(app, node, port, image, fn);
      });
    }, fn);
  });
}

function tearDownInstance(app, host, port, fn) {
  console.log('Killing instance at ' + host + ':' + port);
  async.waterfall([
    function(fn) {
      stopContainerByPort(host, port, fn);
    },
    function(result, fn) {
      service.removeAppInstance(app, host + ':' + port, fn);
    }
  ], fn);
}

function deployAppInstances(app, image, fn) {
  service.loadAppInstances(app, function(err, instances) {
    if (err) {
      return fn(err);
    }
    if (instances.length) {
      var cb = fn;
      fn = function() {
        async.map(instances, function(instance, fn) {
          var parts = instance.split(':');
          tearDownInstance(app, parts[0], parts[1], fn);
        }, cb);
      };
    }
    deployNewAppInstances(app, image, fn);
  });
}

function loadContainerLogs(host, containerId, fn) {
  var container = dockerCmd(host, 'getContainer', containerId);
  container.logs({
    timestamps: true,
    stdout: true,
    stderr: true,
  }, fn);
}

function loadAppLogs(app, fn) {
  async.waterfall([
    function(fn) {
      service.loadAppInstances(app, fn)
    },
    function(instances, fn) {
      async.map(instances, function(instance, fn) {
        var parts = instance.split(':');
        var host  = parts[0];
        var port  = parts[1];
        loadContainerByHostAndPort(host, port, function(err, container) {
          if (err) {
            return fn(err);
          }
          loadContainerLogs(host, container.Id, fn);
        });
      }, fn);
    },
  ], fn);
}

exports.deployAppInstances = deployAppInstances;
exports.loadAppLogs = loadAppLogs;
