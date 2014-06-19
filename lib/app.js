/* jslint node: true */
'use strict';

var express    = require('express');
var bodyParser = require('body-parser');
var validator  = require('express-validator');
var url        = require('url');
var _          = require('lodash');
var token      = require('./token');
var service    = require('./service');
var deploy     = require('./deploy');

var app = express();

app.use(bodyParser());
app.use(validator());

app.use(function(req, res, next) {
  token.checkToken(req.headers['x-auth'], function(err, valid) {
    if (!valid) {
      res.json(401, {
        error: 'Invalid token',
      });
    }
    else {
      next();
    }
  });
});

app.get('/apps', function(req, res) {
  service.loadApps(function(err, apps) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json(apps);
  });
});

app.post('/:app/deploy', function(req, res) {
  deploy.deployAppInstances(req.param.app, req.body.image, function(err, result) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.send(200, null);
  });
});

app.get('/:app/hosts', function(req, res) {
  service.loadAppHosts(req.param.app, function(err, hosts) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json(hosts);
  });
});

app.get('/:app/envs', function(req, res) {
  service.loadAppEnvs(req.param.app, function(err, envs) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json(envs);
  });
});

app.post('/:app/envs', function(req, res) {
  service.addAppEnv(req.param.app, req.body.env, function(err, result) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({ok: true});
  });
});

app.delete('/:app/envs/:env', function(req, res) {
  service.removeAppEnv(req.param.app, req.param.env, function(err, result) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({ok: true});
  });
});

module.exports = app;
