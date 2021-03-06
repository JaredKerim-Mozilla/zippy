/*
 * Restify adapter for the forms module.
 * Docs: https://github.com/caolan/forms
 */
var errors = require('errors');
var forms = require('forms');
var fields = forms.fields;
var under = require('underscore');
var when = require('when');

var redisClient = require('./redisclient');

// Expose all of forms' exports.
under.extend(module.exports, forms);


// Add some new fields.
exports.fields.money = function(opt) {
  opt = opt || {};
  opt.validators = opt.validators || [];
  opt.validators.splice(0, 0,
      forms.validators.regexp(
              /[0-9]+\.[0-9]{2}/,
              'This field must be in the format of 0.00.'));

  return fields.string(opt);
};


exports.fields.integer = function(opt) {
  opt.validators = opt.validators || [];
  opt.validators.splice(0, 0,
      forms.validators.regexp(/[0-9]+/, 'This field must be numeric.'));
  return fields.number(opt);
};


// Add some validators.

exports.validators.isValidProduct = function(query) {
  return function(form, field, callback) {
    when(redisClient.hgetall('product-' + field.data))
      .then(function(product) {
        if (query && product) {
          for (var key in query) {
            if (product[key] !== query[key]) {
              product = null;
            }
          }
        }
        if (!product) {
          callback('zero results for product_id ' + field.data);
        } else {
          callback();
        }
      })
      .catch(callback);
  };
};


exports.validators.isValidSeller = function(query) {
  return function(form, field, callback) {
    when(redisClient.hgetall('seller-' + field.data))
      .then(function(seller) {
        if (query && seller) {
          for (var key in query) {
            if (seller[key] !== query[key]) {
              seller = null;
            }
          }
        }
        if (!seller) {
          callback('zero results for seller_id ' + field.data);
        } else {
          callback();
        }
      })
      .catch(callback);
  };
};


exports.validators.mustBeOneOf = function(choices) {
  return function(form, field, callback) {
    if (choices.indexOf(field.data) === -1) {
      callback('value must be one of ' + choices.join(', '));
    } else {
      callback();
    }
  };
};


// Make a custom forms.create()
exports.create = function() {
  var ob = forms.create.apply(this, arguments);

  /*
   * Return a promise to validate the form.
   *
   * Example in a Restify handler:
   *
   *  var myForm = restforms.create(...);
   *
   *  exports.post = function(req, res, next) {
   *    myForm.promise(req)
   *      .then(function(data) {
   *        // The form is valid.
   *        // access data.field
   *        res.send(...);
   *      })
   *      .fail(function(err) {
   *        next(err);
   *      });
   *  };
   */
  ob.promise = function(req) {
    var self = this;
    return when.promise(function(resolve, reject) {

      function getErrors(form) {
        return Object.keys(form.fields).reduce(function(ob, k) {
          var data = form.fields[k];
          if (data.error) {
            ob[k] = data.error;
          }
          return ob;
        }, {});
      }

      var data = req.method === 'GET' ? req.query : req.body;
      // Bind GET or POST data to the form object.
      var newForm = self.bind(data);
      newForm.validate(function(err, form) {
        if (err) {
          reject(err);
        } else if (form.isValid()) {

          // Check for invalid form parameters.
          var ignoredKeys = [];
          if (data) {
            Object.keys(data).forEach(function(k) {
              if (data[k] && !form.data[k]) {
                ignoredKeys.push(k);
              }
            });
          }

          if (ignoredKeys.length) {
            reject(new errors.InvalidArgumentError('Unrecognized fields: ' + ignoredKeys.toString()));
          } else {
            resolve(form.data);
          }

        } else {
          reject(new errors.InvalidArgumentError(JSON.stringify(getErrors(form))));
        }
      });
    });
  };

  return ob;
};
