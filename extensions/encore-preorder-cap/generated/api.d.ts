/**
 * Minimal type stub so the function's JSDoc types (and the vitest suite that
 * imports it) resolve without running `npm run graphql-codegen`. When the real
 * codegen output (api.ts) exists, TypeScript resolves it first and this stub
 * is ignored — safe to keep committed.
 */
export type CartValidationsGenerateRunInput = {
  cart: {
    lines: {
      quantity: number;
      merchandise:
        | {
            __typename: string;
            remaining?: { value: string | null } | null;
            product?: { title: string } | null;
          }
        | null;
    }[];
  };
};

export type CartValidationsGenerateRunResult = {
  operations: {
    validationAdd: { errors: { message: string; target: string }[] };
  }[];
};
