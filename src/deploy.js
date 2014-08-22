/* jshint node: true */
'use strict';

var request  = require('request');
var url      = require('url');
var _        = require('lodash');
var async    = require('async');
var util     = require('./util');
var redisCmd = require('./redis');

var DOCKER_PORT = 2375;
var PORT_RANGE  = _.range(8000, 8999);

function loadApps(fn) {
  redisCmd('smembers', 'apps', fn);
}

function addApp(app, fn) {
  redisCmd('sadd', 'apps', app, fn);
}

function removeApp(app, fn) {
  redisCmd('srem', 'apps', app, fn);
}

function loadAppEnvs(app, fn) {
  redisCmd('smembers', app + ':envs', fn);
}

function addAppEnv(app, env, fn) {
  redisCmd('sadd', app + ':envs', env, fn);
}

function removeAppEnv(app, env, fn) {
  loadAppEnvs(app, function(err, envs) {
    if (err) {
      return fn(err);
    }
    var matches = _.filter(envs, function(e) {
      return new RegExp('^' + env).test(e);
    });
    async.map(matches, function(match, fn) {
      redisCmd('srem', app + ':envs', match, fn);
    }, fn);
  });
}

function loadAppInstances(app, fn) {
  redisCmd('smembers', app + ':instances', fn);
}

function addAppInstance(app, instance, fn) {
  redisCmd('sadd', app + ':instances', instance, function(err, result) {
    if (err) {
      return fn(err);
    }
    notifyRouters(fn);
  });
}

function removeAppInstance(app, instance, fn) {
  redisCmd('srem', app + ':instances', instance, function(err, result) {
    if (err) {
      return fn(err);
    }
    notifyRouters(fn);
  });
}

function loadHosts(fn) {
  redisCmd('smembers', 'hosts', fn);
}

function addHost(host, fn) {
  redisCmd('sadd', 'hosts', host, fn);
}

function removeHost(host, fn) {
  redisCmd('srem', 'hosts', host, fn);
}

function notifyRouters(fn) {
  redisCmd('publish', 'updates', ''+new Date().getTime(), fn);
}

function getUnixTimestamp() {
  return Math.round(new Date().getTime() / 1000);
}

function saveDeployment(app, image, count, fn) {
  var hash = {
    timestamp: getUnixTimestamp(),
    app: app,
    image: image,
    count: count,
  };
  redisCmd('lpush', 'deployments:' + app, JSON.stringify(hash), fn);
}

function loadDeployments(app, fn) {
  redisCmd('lrange', 'deployments:' + app, -100, -1, function(err, results) {
    if (err) {
      return fn(err);
    }
    var deployments = _.map(results, function(item) {
      return JSON.parse(item);
    });
    fn(null, deployments);
  });
}

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
    method: 'post',
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
      loadAppEnvs(app, fn);
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
      if (false && !success) {
        fn(new Error('Failed to deploy new instance.'));
      } else {
        console.log('Adding ' + host + ':' + port + ' to router');
        addAppInstance(app, host + ':' + port, fn);
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
  loadHosts(function(err, hosts) {
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

function getContainerDistribution(fn) {
  var dist = {};
  loadHosts(function(err, hosts) {
    async.each(hosts, function(host, fn) {
      loadContainers(host, function(err, containers) {
        dist[host] = containers.length;
        fn(err);
      });
    }, function(err) {
      fn(err, dist);
    });
  });
}

function deployNewAppInstances(app, image, count, fn) {

  getContainerDistribution(function(err, dist) {
    var totalContainers = _.reduce(dist, function(sum, count, key) {
      return sum + count;
    });

    var hosts = _.keys(dist);
    var totalHosts = hosts.length;
    var idealCountPerHost = Math.ceil((totalContainers + count) / totalHosts);
    var launching = {};
    _.each(hosts, function(host) {
      launching[host] = 0;
    });

    while (count > 0) {
      var host = hosts[count % totalHosts];
      var countForHost = dist[host];
      if (countForHost < idealCountPerHost) {
        launching[host]++;
        count--;
      }
    }

    async.map(hosts, function(host, fn) {
      if (launching[host]) {
        async.times(launching[host], function(n, fn) {
          findAvailablePort(host, function(err, port) {
            if (err) {
              fn(err);
            } else {
              deployAppInstance(app, host, port, image, fn);
            }
          });
        }, fn);
      } else {
        fn();
      }
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
      removeAppInstance(app, host + ':' + port, fn);
    }
  ], fn);
}

function deployAppInstances(app, image, count, fn) {
  loadAppInstances(app, function(err, instances) {
    if (err) {
      return fn(err);
    }
    if (instances.length) {
      var cb = fn;
      fn = function(err) {
        if (err) {
          fn(err);
        } else {
          saveDeployment(app, image, count, _.noop);
          async.map(instances, function(instance, fn) {
            var parts = instance.split(':');
            killAppInstance(app, parts[0], parts[1], fn);
          }, cb);
        }
      };
    }
    deployNewAppInstances(app, image, count, fn);
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
      loadAppInstances(app, fn);
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
  loadAppInstances(app, function(err, instances) {
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
  loadApps(function(err, apps) {
    async.each(apps, function(app, fn) {
      output[app] = {};
      async.waterfall([
        function(fn) {
          loadAppInstances(app, function(err, instances) {
            output[app].instances = instances;
            fn(err);
          });
        },
        function(fn) {
          loadAppEnvs(app, function(err, envs) {
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
exports.loadDeployments    = loadDeployments;
exports.loadAppLogs        = loadAppLogs;
exports.killAppInstances   = killAppInstances;
exports.describe           = describe;
