// @ts-check
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");
const checkFile = require("eslint-plugin-check-file");

module.exports = tseslint.config(
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],
      // Project naming convention (see docs/CodingStandards.md at the repo root): methods and
      // functions are PascalCase, variables/parameters/properties are camelCase. This is an
      // explicit, intentional project decision — it does not match this rule's more common
      // default (camelCase methods), and that's on purpose.
      //
      // One case this rule can't express without type-aware linting (not worth turning on
      // project-wide for this alone): a `const` holding a function — e.g. Angular's functional
      // HttpInterceptorFn/CanActivateFn building blocks — is syntactically a "variable", not a
      // "function", so it falls under the camelCase variable rule below by default even though
      // this project treats it as a function for naming purposes. Those specific declarations
      // carry their own targeted `eslint-disable-next-line` with this same justification.
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: ["method", "function"],
          format: ["PascalCase"],
          // Framework/library-mandated names this project doesn't control — every one of these
          // is a fixed property key a third-party type requires exactly as spelled, not a name
          // this project chose:
          //   - Angular lifecycle hooks (ngOnInit, ngOnDestroy, ngOnChanges, ...)
          //   - RxJS's Observer interface (`next`/`error`/`complete`, e.g. in `tap({ next, error })`)
          //   - TanStack Query's options-object callbacks (queryFn, mutationFn, onMutate, onError,
          //     onSuccess, onSettled, select) — used throughout core/facades/*.ts
          //   - Angular Router's Route config (loadComponent, loadChildren, canActivate, canMatch,
          //     canDeactivate, resolve) — used in App.routes.ts
          filter: {
            regex:
              "^(ng[A-Z].*|next|error|complete|queryFn|mutationFn|onMutate|onError|onSuccess|onSettled|select|loadComponent|loadChildren|canActivate|canActivateChild|canDeactivate|canMatch|resolve)$",
            match: false,
          },
        },
        {
          selector: ["variable", "parameter", "parameterProperty"],
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "property",
          format: ["camelCase"],
          leadingUnderscore: "allow",
          // GitHub's REST API responses/request bodies use snake_case field names (created_at,
          // total_count, key_id, ...) — these are an external wire format this project doesn't
          // control, ported verbatim from web/src/api/*.ts's own Raw* interfaces. Our own
          // domain properties never contain an underscore or hyphen, so this filter exempts
          // exactly (and only) the external-contract fields.
          filter: { regex: "[_-]", match: false },
        },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase"] },
      ],
    },
  },
  {
    // Filename convention: PascalCase, with Angular's required lowercase type-suffix
    // (.component.ts, .service.ts, ...) treated as tooling metadata rather than part of "the
    // name" — ignoreMiddleExtensions strips that suffix before the case check runs, so
    // `ItemEditorPanel.component.ts` is checked as `ItemEditorPanel`, not
    // `ItemEditorPanel.component`. Scoped to src/app so main.ts (a framework entry point, not a
    // named module) is left alone, same reasoning as the type-suffix exemption.
    files: ["src/app/**/*.ts"],
    plugins: { "check-file": checkFile },
    rules: {
      "check-file/filename-naming-convention": [
        "error",
        { "**/*.ts": "PASCAL_CASE" },
        { ignoreMiddleExtensions: true },
      ],
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  }
);
