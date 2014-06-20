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
    res.json({error: false, apps: apps});
  });
});

app.get('/hosts', function(req, res) {
  service.loadHosts(function(err, hosts) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false, hosts: hosts});
  });
});

app.post('/hosts', function(req, res) {
  service.addHost(req.body.host, function(err) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false});
  });
});

app.delete('/hosts/:host', function(req, res) {
  service.removeHost(req.body.node, function(err) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false});
  });
});

app.post('/:app/deploy', function(req, res) {
  deploy.deployAppInstances(req.params.app, req.body.image, function(err, result) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false});
  });
});

app.get('/:app/instances', function(req, res) {
  service.loadAppInstances(req.params.app, function(err, instances) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false, instances: instances});
  });
});

app.get('/:app/envs', function(req, res) {
  service.loadAppEnvs(req.params.app, function(err, envs) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false, envs: envs});
  });
});

app.post('/:app/envs', function(req, res) {
  service.addAppEnv(req.params.app, req.body.env, function(err, result) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false});
  });
});

app.delete('/:app/envs/:env', function(req, res) {
  service.removeAppEnv(req.params.app, req.params.env, function(err, result) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false});
  });
});

module.exports = app;
