import { setEngineValidationFns, type EngineValidationFns } from 'lsp-common';
import liquidValidations from 'liquidjs/validations.js';
import dependencyGraph from 'liquidjs/dependency-graph.js';

const validations = liquidValidations as {
  checkValidJSON: EngineValidationFns['checkValidJSON'];
  checkAtleastOneDynamicTableAssignPresent: EngineValidationFns['checkAtleastOneDynamicTableAssignPresent'];
};

const graph = dependencyGraph as {
  parseAssign: EngineValidationFns['parseAssign'];
};

setEngineValidationFns({
  checkValidJSON: validations.checkValidJSON,
  checkAtleastOneDynamicTableAssignPresent:
    validations.checkAtleastOneDynamicTableAssignPresent,
  parseAssign: graph.parseAssign,
});
