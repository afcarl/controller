'use strict';

var request = require('request');
var async   = require('async');
var _       = require('lodash');
var util    = require('./util');
var hosts   = require('./hosts');

function createContainer(host, createOptions, fn) {
  request.post({
    url: util.getDockerUrl(host, 'containers/create'),
    json: true,
    body: createOptions,
  }, function(err, res, body) {
    fn(err, body);
  });
}

function startContainer(host, containerId, startOptions, fn) {
  request.post({
    url: util.getDockerUrl(host, 'containers/' + containerId + '/start'),
    json: true,
    body: startOptions,
  }, function(err, res, body) {
    fn(err, body); // TODO: why is body blank? docs suggest otherwise
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
      startContainer(host, container.Id, startOptions, function(err) {
        fn(err, container.Id);
      });
    }
  ], fn);
}

function runContainer(host, port, image, envs, fn) {

  var createOptions = {
    Hostname: '',
    User: '',
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    OpenStdin: false,
    StdinOnce: false,
    Env: envs,
    Cmd: null,
    Image: image,
    Volumes: {},
    VolumesFrom: '',
    ExposedPorts: {'3000/tcp': {}},
  };

  createAndStartContainer(host, port, createOptions, fn);
}

function loadContainers(host, fn) {
  request({
    url: util.getDockerUrl(host, 'containers/json'),
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
    url: util.getDockerUrl(host, 'containers/' + containerId + '/json'),
    method: 'post',
    qs: {t: 0},
  }, function(err, res, body) {
    fn(err, body);
  });
}

function stopContainer(host, containerId, fn) {
  request({
    url: util.getDockerUrl(host, 'containers/' + containerId + '/stop'),
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

function countRunningContainers(host, fn) {
  loadContainers(host, function(err, containers) {
    if (err) {
      return fn(err);
    }
    fn(null, (_.isArray(containers) ? containers.length : 0));
  });
}

function countAllRunningContainers(fn) {
  hosts.loadHosts(function(err, hosts) {
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
  hosts.loadHosts(function(err, hosts) {
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

exports.createContainer = createContainer;
exports.createAndStartContainer = createAndStartContainer;
exports.startContainer = startContainer;
exports.runContainer = runContainer;
exports.loadContainers = loadContainers;
exports.loadContainerByHostAndPort = loadContainerByHostAndPort;
exports.inspectContainer = inspectContainer;
exports.stopContainer = stopContainer;
exports.stopContainerByPort = stopContainerByPort;
exports.countRunningContainers = countRunningContainers;
exports.countAllRunningContainers = countAllRunningContainers;
exports.getContainerDistribution = getContainerDistribution;
