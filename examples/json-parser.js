// Simple JSON Parser
// Demonstrates: string parsing, recursion, union types (different value types), error handling

function JSONParser(input) {
  let pos = 0;

  function error(message) {
    throw new Error("Parse error at position " + pos + ": " + message);
  }

  function peek() {
    return input[pos];
  }

  function consume() {
    return input[pos++];
  }

  function skipWhitespace() {
    while (pos < input.length) {
      const ch = peek();
      if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") {
        pos++;
      } else {
        break;
      }
    }
  }

  function parseString() {
    if (consume() !== '"') {
      error('Expected "');
    }

    let result = "";
    while (pos < input.length) {
      const ch = consume();
      if (ch === '"') {
        return result;
      } else if (ch === "\\") {
        const escaped = consume();
        if (escaped === "n") result += "\n";
        else if (escaped === "t") result += "\t";
        else if (escaped === "r") result += "\r";
        else if (escaped === '"') result += '"';
        else if (escaped === "\\") result += "\\";
        else if (escaped === "/") result += "/";
        else error("Unknown escape sequence: \\" + escaped);
      } else {
        result += ch;
      }
    }
    error("Unterminated string");
  }

  function parseNumber() {
    let numStr = "";
    let ch = peek();

    // Handle negative
    if (ch === "-") {
      numStr += consume();
      ch = peek();
    }

    // Integer part
    while (ch >= "0" && ch <= "9") {
      numStr += consume();
      ch = peek();
    }

    // Decimal part
    if (ch === ".") {
      numStr += consume();
      ch = peek();
      while (ch >= "0" && ch <= "9") {
        numStr += consume();
        ch = peek();
      }
    }

    // Exponent part
    if (ch === "e" || ch === "E") {
      numStr += consume();
      ch = peek();
      if (ch === "+" || ch === "-") {
        numStr += consume();
        ch = peek();
      }
      while (ch >= "0" && ch <= "9") {
        numStr += consume();
        ch = peek();
      }
    }

    return parseFloat(numStr);
  }

  function parseArray() {
    if (consume() !== "[") {
      error("Expected [");
    }

    const arr = [];
    skipWhitespace();

    if (peek() === "]") {
      consume();
      return arr;
    }

    while (true) {
      skipWhitespace();
      arr.push(parseValue());
      skipWhitespace();

      const ch = consume();
      if (ch === "]") {
        return arr;
      } else if (ch !== ",") {
        error("Expected , or ]");
      }
    }
  }

  function parseObject() {
    if (consume() !== "{") {
      error("Expected {");
    }

    const obj = {};
    skipWhitespace();

    if (peek() === "}") {
      consume();
      return obj;
    }

    while (true) {
      skipWhitespace();

      if (peek() !== '"') {
        error("Expected string key");
      }
      const key = parseString();

      skipWhitespace();
      if (consume() !== ":") {
        error("Expected :");
      }

      skipWhitespace();
      obj[key] = parseValue();
      skipWhitespace();

      const ch = consume();
      if (ch === "}") {
        return obj;
      } else if (ch !== ",") {
        error("Expected , or }");
      }
    }
  }

  function parseKeyword(expected, value) {
    for (let i = 0; i < expected.length; i++) {
      if (consume() !== expected[i]) {
        error("Expected " + expected);
      }
    }
    return value;
  }

  function parseValue() {
    skipWhitespace();
    const ch = peek();

    if (ch === '"') {
      return parseString();
    } else if (ch === "{") {
      return parseObject();
    } else if (ch === "[") {
      return parseArray();
    } else if (ch === "t") {
      return parseKeyword("true", true);
    } else if (ch === "f") {
      return parseKeyword("false", false);
    } else if (ch === "n") {
      return parseKeyword("null", null);
    } else if (ch === "-" || (ch >= "0" && ch <= "9")) {
      return parseNumber();
    } else {
      error("Unexpected character: " + ch);
    }
  }

  const result = parseValue();
  skipWhitespace();

  if (pos !== input.length) {
    error("Unexpected trailing characters");
  }

  return result;
}

// Test the parser
const testCases = [
  '{"name": "John", "age": 30, "active": true}',
  '[1, 2, 3, "four", null, false]',
  '{"nested": {"a": 1, "b": [1, 2, 3]}, "empty": {}}',
  '"hello world"',
  '42.5',
  'true',
  'null'
];

for (let i = 0; i < testCases.length; i++) {
  const input = testCases[i];
  const parsed = JSONParser(input);
  console.log("Input: " + input);
  console.log("Parsed: " + JSON.stringify(parsed));
  console.log("---");
}
