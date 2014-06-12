/* jslint node: true */
'use strict';

var express    = require('express');
var async      = require('async');
var bodyParser = require('body-parser');
var validator  = require('express-validator');
var url        = require('url');
var Docker     = require('dockerode');
var redis      = require('redis');
var _          = require('lodash');

var DOCKER_PORT = 4243;

var app = express();

app.use(bodyParser());
app.use(validator());

var redisClient = redis.createClient();

function loadDockerHosts(appDomain, fn) {
  redisClient.smembers(appDomain + ':hosts', function(err, hosts) {
    if (err) {
      return fn(err);
    }
    fn(null, hosts);
  });
}

function loadAppEnvs(appDomain, fn) {
  redisClient.smembers(appDomain + ':envs', function(err, envs) {
    if (err) {
      return fn(err);
    }
    fn(null, envs);
  });
}

function runContainer(host, imageName, envs, fn) {
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
    'Image': imageName,
    'Volumes': {},
    'VolumesFrom': '',
    'ExposedPorts': {'3001/tcp': {}},
  };

  docker.createContainer(createOptions, function(err, container) {
    container.start({
      'PortBindings': {
        '3001/tcp': [{'HostPort': '3001'}]
      }
    }, function(err, data) {
      if (err) {
        return fn(err);
      }
      fn(null, data);
    });
  });
}

function deployDockerContainer(host, imageName, envs, fn) {
  var docker = new Docker({
    host: 'http://' + host,
    port: DOCKER_PORT,
  });
  docker.listContainers(function (err, containers) {
    var match = _.first(_.where(containers, {Image: imageName}));
    if (match) {
      docker.getContainer(match.Id).stop(function(err) {
        runContainer(host, imageName, envs, fn);
      });
    } else {
      runContainer(host, imageName, envs, fn);
    }
  });
}

function loadAppConfig(appDomain, fn) {
  async.parallel({
    hosts: _.partial(loadDockerHosts, appDomain),
    envs: _.partial(loadAppEnvs, appDomain),
  }, fn);
}

function deployDockerContainers(appDomain, imageName, fn) {
  loadAppConfig(appDomain, function(err, config) {
    if (err) {
      return fn(err);
    }
    async.map(config.hosts, function(host, fn) {
      host = host.replace(/:\d+/, '');
      deployDockerContainer(host, imageName, config.envs, fn);
    }, function(err, results) {
      fn(null, results);
    });
  });
}

app.post('/deploy', function(req, res) {
  deployDockerContainers(req.body.domain, req.body.image, function(err, result) {
    if (err) {
      return res.send(400, err);
    }
    res.send(204, '');
  });
});

module.exports = app;
