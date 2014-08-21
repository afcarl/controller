/* jshint node: true */
'use strict';

var request = require('request');
var url     = require('url');
var _       = require('lodash');
var async   = require('async');
var util    = require('./util');
var service = require('./service');

var DOCKER_PORT = 2375;
var PORT_RANGE  = _.range(8000, 8999);

function createContainer(host, createOptions, fn) {
  request({
    url: getDockerUrl(host, 'containers/create'),
    method: 'post',
    json: true,
    body: createOptions,
  }, function(err, res, body) {
    fn(err, body);
  });
}

function startContainer(host, containerId, startOptions, fn) {
  request({
    url: getDockerUrl(host, 'containers/' + containerId + '/start'),
    json: true,
    method: 'post',
    body: startOptions,
  }, function(err, res, body) {
    fn(err, body);
  });
}

function createAndStartContainer(host, externalPort, createOptions, fn) {
  async.waterfall([
    function(fn) {
      createContainer(host, createOptions, fn);
    },
    function(container, fn) {
      var startOptions = {
        'PortBindings': {
          '3000/tcp': [{'HostPort': ''+externalPort}]
        }
      };
      startContainer(host, container.Id, startOptions, fn);
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

function getDockerUrl(host, path) {
  return 'http://' + host + ':' + DOCKER_PORT + '/' + path;
}

function parseDockerImage(image) {
  var parts = image.split(':');
  return {
    image: parts[0],
    tag: parts[1],
  };
}

function pullDockerImage(host, image, fn) {
  var parts = parseDockerImage(image);
  request({
    url: getDockerUrl(host, 'images/create'),
    method: 'post',
    qs: {
      fromImage: parts.name,
      tag: parts.tag,
    }
  }, function(err, res, body) {
    fn(err);
  });
}

function loadContainers(host, fn) {
  request({
    url: getDockerUrl(host, 'containers/json'),
    json: true,
  }, function(err, res, body) {
    fn(err, body);
  });
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
  request({
    url: getDockerUrl(host, 'containers/' + containerId + '/json'),
    method: 'post',
    qs: {t: 0},
  }, function(err, res, body) {
    fn(err, body);
  });
}

function stopContainer(host, containerId, fn) {
  request({
    url: getDockerUrl(host, 'containers/' + containerId + '/stop'),
    json: true,
  }, function(err, res, body) {
    fn(err, body);
  });
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
      killAppInstance(app, host, port, function(_err) {
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

function getNumDeployHosts() {
  return 2; // TODO smarter, specified by cli?
}

function deployNewAppInstances(app, image, fn) {
  var n = getNumDeployHosts();
  getLeastUtilizedHosts(n, function(err, hosts) {
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

function killAppInstance(app, host, port, fn) {
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
          killAppInstance(app, parts[0], parts[1], fn);
        }, cb);
      };
    }
    deployNewAppInstances(app, image, fn);
  });
}

function loadContainerLogs(host, containerId, fn) {
  request({
    url: getDockerUrl(host, 'containers/' + containerId + '/logs'),
    method: 'get',
    qs: {
      stdout: 1,
      stderr: 1,
    }
  }, function(err, res, body) {
    fn(err, body);
  });
}

function loadAppLogs(app, fn) {
  async.waterfall([
    function(fn) {
      service.loadAppInstances(app, fn);
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
          console.log('Loading logs for ' + instance);
          loadContainerLogs(host, container.Id, fn);
        });
      }, fn);
    },
  ], fn);
}

function killAppInstances(app, fn) {
  service.loadAppInstances(app, function(err, instances) {
    if (err) {
      return fn(err);
    }
    if (instances.length) {
      async.map(instances, function(instance, fn) {
        var parts = instance.split(':');
        var host  = parts[0];
        var port  = parts[1];
        killAppInstance(app, host, port, fn);
      }, fn);
    }
  });
}

function describe(fn) {
  var output = {};
  service.loadApps(function(err, apps) {
    async.each(apps, function(app, fn) {
      output[app] = {};
      async.waterfall([
        function(fn) {
          service.loadAppInstances(app, function(err, instances) {
            output[app].instances = instances;
            fn(err);
          });
        },
        function(fn) {
          service.loadAppEnvs(app, function(err, envs) {
            output[app].envs = envs;
            fn(err);
          });
        },
        function(fn) {
          if (output[app].instances.length > 0) {
            var instance = output[app].instances[0];
            var parts = instance.split(':');
            loadContainerByHostAndPort(parts[0], parts[1], function(err, container) {
              output[app].image = container.Image;
              fn(err);
            });
          } else {
            fn(null);
          }
        }
      ], fn);
    }, function(err) {
      fn(err, output);
    });
  });
}

exports.deployAppInstances = deployAppInstances;
exports.loadAppLogs        = loadAppLogs;
exports.killAppInstances   = killAppInstances;
exports.describe           = describe;
