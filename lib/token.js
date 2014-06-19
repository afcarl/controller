var crypto   = require('crypto');
var redisCmd = require('./redis');

function createToken(fn) {
  return crypto
    .createHash('sha1')
    .update(''+new Date().getTime())
    .digest('hex');
}

function getToken(fn) {
  var client =
  redisCmd('get', 'token', function(err, token) {
    if (err) {
      return fn(err);
    }
    if (!token) {
      createToken(fn);
    }
    else {
      fn(null, token);
    }
  });
}

function checkToken(compare, fn) {
  getToken(function(err, token) {
    if (err) {
      return fn(err);
    }
    fn(null, token == compare);
  });
}

exports.checkToken = checkToken;
