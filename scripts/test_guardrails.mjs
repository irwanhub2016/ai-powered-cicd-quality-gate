import ts from '../playwright_template/node_modules/typescript/lib/typescript.js';

const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put']);

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, child => visit(child, callback));
}

function unwrap(node) {
  while (
    ts.isAwaitExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function propertyName(node) {
  return ts.isPropertyAccessExpression(node) ? node.name.text : null;
}

function callName(node) {
  if (ts.isIdentifier(node)) return node.text;
  return propertyName(node);
}

function getTestCallback(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current) && current.parent && ts.isCallExpression(current.parent)) {
      const call = current.parent;
      const isTestCall =
        ts.isIdentifier(call.expression) && call.expression.text === 'test' ||
        ts.isPropertyAccessExpression(call.expression) &&
          ts.isIdentifier(call.expression.expression) &&
          call.expression.expression.text === 'test';

      if (isTestCall && call.arguments.includes(current)) return current;
    }
    current = current.parent;
  }
  return null;
}

function findResponseVariable(requestCall) {
  let current = requestCall.parent;
  while (current && !ts.isVariableDeclaration(current)) current = current.parent;
  return current && ts.isIdentifier(current.name) ? current.name.text : null;
}

function getResponseSchema(spec, response) {
  const schema = response?.schema;
  if (!schema) return null;
  if (!schema.$ref?.startsWith('#/definitions/')) return schema;
  return spec.definitions?.[schema.$ref.slice('#/definitions/'.length)] ?? null;
}

function getSchemaProperties(spec, operation, statusCodes) {
  const properties = new Map();
  for (const status of statusCodes) {
    const schema = getResponseSchema(spec, operation.responses?.[String(status)]);
    for (const [name, definition] of Object.entries(schema?.properties ?? {})) {
      properties.set(name, definition.type);
    }
  }
  return properties;
}

function findResponseAssertions(callback, responseName) {
  const bodyNames = new Set();
  const statusCodes = new Set();
  const assertedProperties = new Map();
  const typeAssertions = [];

  visit(callback, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = unwrap(node.initializer);
      if (
        ts.isCallExpression(initializer) &&
        propertyName(initializer.expression) === 'json' &&
        ts.isIdentifier(initializer.expression.expression) &&
        initializer.expression.expression.text === responseName
      ) {
        bodyNames.add(node.name.text);
      }
    }
  });

  visit(callback, node => {
    if (!ts.isCallExpression(node) || callName(node.expression) !== 'toBe') return;
    const expectCall = unwrap(node.expression.expression);
    if (!ts.isCallExpression(expectCall) || callName(expectCall.expression) !== 'expect') return;
    const actual = unwrap(expectCall.arguments[0]);

    if (
      ts.isCallExpression(actual) &&
      propertyName(actual.expression) === 'status' &&
      ts.isIdentifier(actual.expression.expression) &&
      actual.expression.expression.text === responseName
    ) {
      const expectedStatus = unwrap(node.arguments[0]);
      if (expectedStatus && ts.isNumericLiteral(expectedStatus)) {
        statusCodes.add(Number(expectedStatus.text));
      }
    }

    if (
      ts.isCallExpression(actual) &&
      propertyName(actual.expression) === 'toHaveProperty' &&
      ts.isIdentifier(actual.expression.expression) &&
      bodyNames.has(actual.expression.expression.text)
    ) {
      const key = unwrap(actual.arguments[0]);
      if (key && ts.isStringLiteral(key)) assertedProperties.set(key.text, node);
      return;
    }

    if (ts.isTypeOfExpression(actual) && ts.isPropertyAccessExpression(actual.expression)) {
      const bodyProperty = actual.expression;
      if (!ts.isIdentifier(bodyProperty.expression) || !bodyNames.has(bodyProperty.expression.text)) return;
      const expectedType = unwrap(node.arguments[0]);
      if (expectedType && ts.isStringLiteral(expectedType)) {
        assertedProperties.set(bodyProperty.name.text, node);
        typeAssertions.push({ property: bodyProperty.name.text, type: expectedType.text });
      }
    }
  });

  visit(callback, node => {
    if (ts.isCallExpression(node) && callName(node.expression) === 'expect') {
      const actual = unwrap(node.arguments[0]);
      if (ts.isPropertyAccessExpression(actual) && ts.isIdentifier(actual.expression)) {
        if (bodyNames.has(actual.expression.text)) assertedProperties.set(actual.name.text, node);
      }
    }

    if (!ts.isCallExpression(node) || callName(node.expression) !== 'toHaveProperty') return;
    const expectCall = unwrap(node.expression.expression);
    if (!ts.isCallExpression(expectCall) || callName(expectCall.expression) !== 'expect') return;
    const body = unwrap(expectCall.arguments[0]);
    if (!ts.isIdentifier(body) || !bodyNames.has(body.text)) return;
    const key = unwrap(node.arguments[0]);
    if (key && ts.isStringLiteral(key)) assertedProperties.set(key.text, node);
  });

  return { statusCodes, assertedProperties, typeAssertions };
}

export function validateTypeScriptAST(code, type = 'API') {
  if (!code || code.length < 50) {
    throw new Error(`Generated ${type} test code is suspiciously empty.`);
  }

  const sourceFile = ts.createSourceFile(
    `temp-${type}.spec.ts`,
    code,
    ts.ScriptTarget.Latest,
    true
  );
  const diagnostics = sourceFile.parseDiagnostics || [];
  if (diagnostics.length > 0) {
    const errors = diagnostics.slice(0, 3).map(diagnostic => {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
      return `Line ${line + 1}:${character + 1} - ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
    });
    throw new Error(`TypeScript syntax validation failed for ${type} test:\n${errors.join('\n')}`);
  }

  if (!code.includes('@playwright/test')) {
    throw new Error(`Generated ${type} test is missing '@playwright/test' import.`);
  }
  if (!code.includes('test(') && !code.includes('test.describe(')) {
    throw new Error(`Generated ${type} test contains no Playwright test definitions.`);
  }
}

export function validateApiTestSemantics(code, spec) {
  const sourceFile = ts.createSourceFile('generated-api.spec.ts', code, ts.ScriptTarget.Latest, true);
  const errors = [];
  const requests = [];

  visit(sourceFile, node => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !ts.isIdentifier(node.expression.expression) ||
      node.expression.expression.text !== 'request'
    ) {
      return;
    }
    requests.push(node);
  });

  if (requests.length === 0) {
    throw new Error('API semantic validation failed: no request.<method>(...) calls were found.');
  }

  for (const requestCall of requests) {
    const method = propertyName(requestCall.expression);
    const routeArgument = unwrap(requestCall.arguments[0] ?? ts.factory.createIdentifier(''));
    const route = ts.isStringLiteral(routeArgument) ? routeArgument.text.split('?')[0] : null;
    const testCallback = getTestCallback(requestCall);
    const location = testCallback?.name?.getText(sourceFile) ?? 'API test';

    if (!HTTP_METHODS.has(method)) {
      errors.push(`${location}: unsupported request method "${method}".`);
      continue;
    }
    if (!route) {
      errors.push(`${location}: request.${method} must use a static Swagger path.`);
      continue;
    }

    const operation = spec.paths?.[route]?.[method];
    if (!operation) {
      errors.push(`${location}: ${method.toUpperCase()} ${route} is not defined in Swagger.`);
      continue;
    }
    if (!testCallback) {
      errors.push(`${method.toUpperCase()} ${route}: request is not inside a Playwright test callback.`);
      continue;
    }

    const responseName = findResponseVariable(requestCall);
    if (!responseName) {
      errors.push(`${method.toUpperCase()} ${route}: response must be assigned to a variable for validation.`);
      continue;
    }

    const { statusCodes, assertedProperties, typeAssertions } =
      findResponseAssertions(testCallback, responseName);
    if (statusCodes.size === 0) {
      errors.push(`${method.toUpperCase()} ${route}: no numeric response.status() assertion was found.`);
      continue;
    }

    const undeclaredStatuses = [...statusCodes].filter(
      status => !Object.hasOwn(operation.responses ?? {}, String(status))
    );
    if (undeclaredStatuses.length > 0) {
      errors.push(
        `${method.toUpperCase()} ${route}: status assertion(s) ${undeclaredStatuses.join(', ')} are not declared in Swagger.`
      );
    }

    const responseProperties = getSchemaProperties(spec, operation, statusCodes);
    if (assertedProperties.size === 0) {
      errors.push(
        `${method.toUpperCase()} ${route}: assert at least one response property declared by its Swagger response schema.`
      );
    }
    for (const property of assertedProperties.keys()) {
      if (!responseProperties.has(property)) {
        errors.push(
          `${method.toUpperCase()} ${route}: response property "${property}" is not declared for asserted status(es) ${[...statusCodes].join(', ')}.`
        );
      }
    }
    for (const assertion of typeAssertions) {
      const schemaType = responseProperties.get(assertion.property);
      if (schemaType && schemaType !== assertion.type) {
        errors.push(
          `${method.toUpperCase()} ${route}: "${assertion.property}" is asserted as ${assertion.type}, but Swagger declares ${schemaType}.`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`API semantic validation failed:\n- ${errors.join('\n- ')}`);
  }
}
