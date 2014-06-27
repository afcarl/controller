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

app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());
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

app.post('/apps', function(req, res) {

  req.assert('app').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

  service.addApp(req.body.app, function(err) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false});
  });
});

app.delete('/apps/:app', function(req, res) {

  req.assert('app').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

  service.removeApp(req.params.app, function(err) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false});
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

  req.assert('host').isIP();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

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
  req.assert('host').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

  service.removeHost(req.body.host, function(err) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false});
  });
});

app.post('/:app/deploy', function(req, res) {

  req.assert('app').notEmpty();
  req.assert('image').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

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

  req.assert('app').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

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

  req.assert('app').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

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

  req.assert('app').notEmpty();
  req.assert('env').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

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

  req.assert('app').notEmpty();
  req.assert('env').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

  service.removeAppEnv(req.params.app, req.params.env, function(err, result) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false});
  });
});

app.get('/:app/logs', function(req, res) {

  req.assert('app').notEmpty();

  var errors = req.validationErrors();
  if (errors) {
    return res.json({error: errors[0].msg});
  }

  deploy.loadAppLogs(req.params.app, function(err, logs) {
    if (err) {
      return res.json(500, {
        error: err.message
      });
    }
    res.json({error: false, logs: logs});
  });
});

module.exports = app;
