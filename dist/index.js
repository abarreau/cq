'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NodeTypes = undefined;

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }(); /**
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          * cq Query Resolver
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          *
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          * This file takes input code and a parsed query and extracts portions of the
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          * code based on that query
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          *
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          */


exports.default = cq;

var _babelTraverse = require('babel-traverse');

var _babelTraverse2 = _interopRequireDefault(_babelTraverse);

var _queryParser = require('./query-parser');

var _queryParser2 = _interopRequireDefault(_queryParser);

var _babylon = require('./engines/babylon');

var _babylon2 = _interopRequireDefault(_babylon);

var _typescript = require('./engines/typescript');

var _typescript2 = _interopRequireDefault(_typescript);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _toArray(arr) { return Array.isArray(arr) ? arr : Array.from(arr); }

var NodeTypes = exports.NodeTypes = {
  IDENTIFIER: 'IDENTIFIER',
  RANGE: 'RANGE',
  LINE_NUMBER: 'LINE_NUMBER',
  STRING: 'STRING',
  CALL_EXPRESSION: 'CALL_EXPRESSION'
};

function adjustRangeWithContext(code, linesBefore, linesAfter, _ref) {
  var start = _ref.start;
  var end = _ref.end;

  // get any extra lines, if requested
  var numPreviousLines = 0;
  var numFollowingLines = 0;
  var hasPreviousLines = false;
  var hasFollowingLines = false;

  if (linesBefore > 0) {
    numPreviousLines = linesBefore;
    hasPreviousLines = true;
  }

  if (linesAfter > 0) {
    numFollowingLines = linesAfter + 1;
    hasFollowingLines = true;
  }

  if (hasPreviousLines) {
    while (start > 0 && numPreviousLines >= 0) {
      start--;
      if (code[start] === '\n') {
        numPreviousLines--;
      }
    }
    start++; // don't include prior newline
  }

  if (hasFollowingLines) {
    while (end < code.length && numFollowingLines > 0) {
      if (code[end] === '\n') {
        numFollowingLines--;
      }
      end++;
    }
    end--; // don't include the last newline
  }

  return { start: start, end: end };
}

var whitespace = new Set([' ', '\n', '\t', '\r']);

function modifyAnswerWithCall(code, callee, args, _ref2) {
  var start = _ref2.start;
  var end = _ref2.end;

  switch (callee) {
    case 'upto':
      start--;
      // trim all of the whitespace before. TODO could be to make this optional
      while (start > 0 && whitespace.has(code[start])) {
        start--;
      }
      start++;
      return { start: start, end: start };
      break;
    case 'context':
      var _args = _slicedToArray(args, 2);

      var linesBefore = _args[0];
      var linesAfter = _args[1];

      return adjustRangeWithContext(code, linesBefore.value, linesAfter.value, { start: start, end: end });
      break;
    default:
      throw new Error('Unknown function call: ' + callee);
  }
}

function resolveIndividualQuery(ast, root, code, query, engine, opts) {
  switch (query.type) {
    case NodeTypes.CALL_EXPRESSION:
      {
        var callee = query.callee;
        // for now, the first argument is always the inner selection

        var _query$arguments = _toArray(query.arguments);

        var childQuery = _query$arguments[0];

        var args = _query$arguments.slice(1);

        var answer = resolveIndividualQuery(ast, root, code, childQuery, engine, opts);

        // whatever the child answer is, now we modify it given our callee
        answer = modifyAnswerWithCall(code, callee, args, answer);

        // hmm, maybe do this later
        answer.code = code.substring(answer.start, answer.end);

        // get the rest of the parameters
        return answer;
      }
    case NodeTypes.IDENTIFIER:
    case NodeTypes.STRING:
      {
        var nextRoot = void 0;

        switch (query.type) {
          case NodeTypes.IDENTIFIER:
            nextRoot = engine.findNodeWithIdentifier(ast, root, query);
            break;
          case NodeTypes.STRING:
            nextRoot = engine.findNodeWithString(ast, root, query);
            break;
        }

        var range = engine.nodeToRange(nextRoot);

        // we want to keep starting indentation, so search back to the previous
        // newline
        var start = range.start;
        while (start > 0 && code[start] !== '\n') {
          start--;
        }
        start++; // don't include the newline

        // we also want to read to the end of the line for the node we found
        var end = range.end;
        while (end < code.length && code[end] !== '\n') {
          end++;
        }

        var codeSlice = code.substring(start, end);

        if (query.children) {
          return resolveListOfQueries(ast, nextRoot, code, query.children, engine, opts);
        } else {
          return { code: codeSlice, start: start, end: end };
        }
      }
    case NodeTypes.RANGE:
      {
        var rangeStart = resolveIndividualQuery(ast, root, code, query.start, engine, opts);
        var rangeEnd = resolveIndividualQuery(ast, root, code, query.end, engine, opts);
        var _start = rangeStart.start;
        var _end = rangeEnd.end;
        var _codeSlice = code.substring(_start, _end);
        return { code: _codeSlice, start: _start, end: _end };
      }
    case NodeTypes.LINE_NUMBER:
      {

        // Parse special line numbers like EOF
        if (typeof query.value === 'string') {
          switch (query.value) {
            case 'EOF':
              return { code: '', start: code.length, end: code.length };
              break;
            default:
              throw new Error('Unknown LINE_NUMBER: ' + query.value);
          }
        } else {

          if (query.value === 0) {
            throw new Error('Line numbers start at 1, not 0');
          }

          // find the acutal line number
          var lines = code.split('\n');
          var line = lines[query.value - 1]; // one-indexed arguments to LINE_NUMBER

          // to get the starting index of this line...
          // we take the sum of all prior lines:
          var charIdx = lines.slice(0, query.value - 1).reduce(
          // + 1 b/c of the (now missing) newline
          function (sum, line) {
            return sum + line.length + 1;
          }, 0);

          var _start2 = charIdx;
          var _end2 = charIdx + line.length;
          var _codeSlice2 = code.substring(_start2, _end2);
          return { code: _codeSlice2, start: _start2, end: _end2 };
        }
      }
    default:
      break;
  }
}

// given character index idx in code, returns the 1-indexed line number
function lineNumberOfCharacterIndex(code, idx) {
  var everythingUpUntilTheIndex = code.substring(0, idx);
  // computer science!
  return everythingUpUntilTheIndex.split('\n').length;
}

function resolveListOfQueries(ast, root, code, query, engine, opts) {
  return query.reduce(function (acc, q) {
    var resolved = resolveIndividualQuery(ast, root, code, q, engine, opts);
    // thought: maybe do something clever here like put in a comment ellipsis if
    // the queries aren't contiguous
    acc.code = acc.code + resolved.code;
    acc.nodes = [].concat(_toConsumableArray(acc.nodes), [resolved.node]);
    acc.start = Math.min(acc.start, resolved.start);
    acc.end = Math.max(acc.end, resolved.end);
    acc.start_line = Math.min(acc.start_line, lineNumberOfCharacterIndex(code, resolved.start));
    acc.end_line = Math.max(acc.end_line, lineNumberOfCharacterIndex(code, resolved.end));
    return acc;
  }, {
    code: '',
    nodes: [],
    start: Number.MAX_VALUE,
    end: Number.MIN_VALUE,
    start_line: Number.MAX_VALUE,
    end_line: Number.MIN_VALUE
  });
}

function cq(code, query) {
  var opts = arguments.length <= 2 || arguments[2] === undefined ? {} : arguments[2];

  var engine = opts.engine || (0, _babylon2.default)();

  if (typeof query === 'string') {
    query = [_queryParser2.default.parse(query)]; // parser returns single object for now, but eventually an array
  }

  if (typeof engine === 'string') {
    switch (engine) {
      case 'typescript':
        engine = (0, _typescript2.default)();
        break;
      case 'babylon':
        engine = (0, _babylon2.default)();
        break;
      default:
        throw new Error('unknown engine: ' + engine);
    }
  }

  var ast = engine.parse(code, Object.assign({}, opts.parserOpts));
  var root = engine.getInitialRoot(ast);

  return resolveListOfQueries(ast, root, code, query, engine, opts);
}