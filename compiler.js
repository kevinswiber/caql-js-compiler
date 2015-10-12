var Parser = require('caql');

var JSCompiler = module.exports = function() {
  this.fields = [];
  this.conjunctions = [];
  this.disjunctions = [];
  this.filters = [];
  this.sorts = [];
  this.ors = [];
  this.params = {};
  this.fieldMap = {};
};

JSCompiler.prototype.compile = function(ql) {
  var root = Parser.parse(ql);
  root.accept(this);
  return this;
};

JSCompiler.prototype.visit = function(node) {
  this['visit' + node.type](node);
};

JSCompiler.prototype.visitSelectStatement = function(statement) {
  statement.fieldListNode.accept(this);

  if (statement.filterNode) {
    statement.filterNode.accept(this);
  }

  if (statement.orderByNode) {
    statement.orderByNode.accept(this);
  }
};

JSCompiler.prototype.visitFieldList = function(fieldList) {
  var self = this;
  this.fields = fieldList.fields;
};

JSCompiler.prototype.visitFilter = function(filterList) {
  filterList.expression.accept(this);
};

JSCompiler.prototype.visitOrderBy = function(orderBy) {
  this.sorts = orderBy.sortList.sorts;
};

JSCompiler.prototype.visitConjunction = function(conjunction) {
  if (conjunction.isNegated) {
    conjunction.left.negate();
    conjunction.right.negate();
  }

  conjunction.left.expressions = conjunction.right.expressions = [];

  conjunction.left.dir = 'left';
  conjunction.right.dir = 'right';
  conjunction.left.accept(this);
  conjunction.right.accept(this);
};

JSCompiler.prototype.visitDisjunction = function(disjunction) {
  this.ors.push({ isNegated: disjunction.isNegated, value: [] });
  disjunction.left.accept(this);
  disjunction.right.accept(this);
};

JSCompiler.prototype.visitContainsPredicate = function(contains) {
  if (typeof contains.value === 'string'
      && contains.value[0] === '@' && this.params) {
    contains.value = this.params[contains.value.substring(1)];
  }

  this.addFilter(contains);
};

JSCompiler.prototype.visitLikePredicate = function(like) {
  if (typeof like.value === 'string'
      && like.value[0] === '@' && this.params) {
    like.value = this.params[like.value.substring(1)];
  }

  like.value = like.value.replace(/\%/g, '(?:.*)');

  this.addFilter(like);
};

JSCompiler.prototype.visitComparisonPredicate = function(comparison) {
  if (typeof comparison.value === 'string'
      && comparison.value[0] === '@' && this.params) {
    comparison.value = this.params[comparison.value.substring(1)];
  }

  this.addFilter(comparison);
};

JSCompiler.prototype.visitMissingPredicate = function(missing) {
  missing.operator = 'missing';
  this.addFilter(missing);
};

JSCompiler.prototype.addFilter = function(predicate) {
  if (typeof predicate.value === 'boolean' || predicate.value == null) {
    predicate.value = predicate.value
  } else if(!isNaN(predicate.value)) {
    predicate.value = (predicate.value % 1 === 0)
      ? parseInt(predicate.value)
      : parseFloat(predicate.value);
  } else if (typeof predicate.value === 'string' && predicate.value[0] !== '"' && predicate.value[0] !== '\'') {
    // TODO: Use a RegExp.
    predicate.value = '"' + predicate.value + '"';
  }

  var val;
  if (predicate.value !== undefined) {
    val = JSON.parse(predicate.value);
  }

  var field = predicate.field;

  if (this.fieldMap[field]) {
    field = this.fieldMap[field];
  }

  function getField(value, field) {
    if (field.indexOf('.') !== -1) {
      var current = value;
      var props = field.split('.');
      for (var propIndex = 0; propIndex < props.length; propIndex++) {
        var property = props[propIndex];

        if (propIndex < props.length - 1) {
          if (current.hasOwnProperty(property)) {
            current = current[property];
          } else {
            current = null;
          }
        } else {
          if (current && current.hasOwnProperty(property)) {
            current = current[property];
          }
        }
      }

      return current;
    } else {
      return value[field];
    }
  }

  var expr;
  switch(predicate.operator) {
    case 'eq': expr = function(value) { return getField(value, field) == val }; break;
    case 'lt': expr = function(value) { return getField(value, field) < val; }; break;
    case 'lte': expr = function(value) { return getField(value, field) <= val; }; break;
    case 'gt': expr = function(value) { return getField(value, field) > val; }; break;
    case 'gte': expr = function(value) { return getField(value, field) >= val; }; break;
    case 'contains': expr = function(value) { return new RegExp(val, 'i').test(getField(value, field)); }; break;
    case 'like': expr = function(value) { return new RegExp(val, 'i').test(getField(value, field)); }; break;
    case 'missing': expr = function(value) { return !value.hasOwnProperty(field); }; break;
  }

  if (predicate.isNegated) {
    if (predicate.operator === 'contains' || predicate.operator === 'like') {
      expr = function(value) { return new RegExp('^((?!' + val + ').)*$', 'i').test(value[field]); };
    } else {
      var positive = expr;
      expr = function(value) { return !positive(value); };
    }
  }

  var cur = expr;
  if (predicate.expressions) {
    predicate.expressions.push(expr);
    if (predicate.dir === 'right') {
      if (this.ors.length) {
        var cur = function(value) {
          var lastValue;

          for(var i = 0; i < predicate.expressions.length; i++) {
            var fn = predicate.expressions[i];
            lastValue = fn(value);

            if (!lastValue) {
              break;
            }
          }

          return lastValue;
        };
      } else {
        this.filters = this.filters.concat(predicate.expressions);
      }
    }
  }
  if (this.ors.length && (!predicate.expressions || !predicate.dir || predicate.dir === 'right')) {
    var or = this.ors[this.ors.length - 1];
    if (or.value.length < 2) {
      or.value.push(cur);
    }
    
    while (this.ors.length && (or = this.ors[this.ors.length - 1]).value.length == 2) {
      var lastOr = this.ors.pop();
      if (this.ors.length && this.ors[this.ors.length - 1].value.length < 2) {
        this.ors[this.ors.length - 1].value.push(function(obj) {
          if (lastOr.isNegated) {
            if (lastOr.value[0]) {
              return !(lastOr.value[0](obj) || lastOr.value[1](obj));
            } else {
              return !lastOr.value[1](obj);
            }
          } else {
            if (lastOr.value[0]) {
              return lastOr.value[0](obj) || lastOr.value[1](obj);
            } else {
              return lastOr.value[1](obj);
            }
          }
        });
      } else  {
        this.filters.unshift(function(obj) {
          if (lastOr.isNegated) {
            if (lastOr.value[0]) {
              return !(lastOr.value[0](obj) || lastOr.value[1](obj));
            } else {
              return !lastOr.value[1](obj);
            }
          } else {
            if (lastOr.value[0]) {
              return lastOr.value[0](obj) || lastOr.value[1](obj);
            } else {
              return lastOr.value[1](obj);
            }
          }
        });
      }
    }
  } else if (!predicate.expressions) {
    this.filters.unshift(cur);
  }
};

JSCompiler.prototype.filter = function(values) {
  return values.map(this.filterOne.bind(this)).filter(function(value) {
    return value !== undefined;
  });
};

JSCompiler.prototype.filterOne = function(value) {
  var self = this;
  var match = true;

  for (var i = 0; i < this.filters.length; i++) {
    match = this.filters[i](value);
    if (!match) {
      break;
    }
  }

  if (match) {
    if (!this.fields.length
        || this.fields[0] === '*'
        || this.fields[0].name === '*') {
      return value;
    }

    var result = {};
    this.fields.forEach(function(field) {
      if (field.name.indexOf('.') === -1) {
        var name = field.alias || field.name;
        var valueName = self.fieldMap[name] || field.name;
        result[name] = value[valueName];
      } else {
        var currentResult = result;
        var currentValue = value;
        var props = field.name.split('.');
        for (var propIndex = 0; propIndex < props.length; propIndex++) {
          var property = props[propIndex];

          if (propIndex < props.length - 1) {
            if (currentValue.hasOwnProperty(props[propIndex])) {
              if (!currentResult.hasOwnProperty(property)) {
                currentResult[property] = {};
              }

              currentResult = currentResult[property];
              currentValue = currentValue[property];
            }
          } else {
            currentResult[property] = currentValue[property];
          }
        }
      }
    });

    return result;
  }
};

JSCompiler.prototype.sort = function(values) {
  this.sorts.reverse().forEach(function(sort) {
    values = values.sort(function(a, b) {
      var field = sort.field;
      var direction = sort.direction;
      
      if (direction === 'asc') {
        if (a[field] < b[field]) {
          return -1;
        } else if (a[field] > b[field]) {
          return 1;
        }

        return 0;
      } else if (direction === 'desc') {
        if (a[field] < b[field]) {
          return 1;
        } else if (a[field] > b[field]) {
          return -1;
        }

        return 0;
      }
    });
  });

  return values;
};

JSCompiler.prototype.execute = function(entries) {
  var filtered = this.filter(entries);
  var sorted = this.sort(filtered);

  return sorted;
};
