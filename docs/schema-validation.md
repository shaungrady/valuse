# Schema Validation

`valueSchema` pairs a reactive value with a schema validator. The value holds
whatever was last set; validation state lives alongside it as metadata,
following the same pattern as `AsyncState` for async derivations: ignore it if
you don't need it, read it when you do.

ValUse integrates with any schema library that implements
[Standard Schema](https://standardschema.dev): ArkType, Zod, Valibot, Effect
Schema, and others. The `@standard-schema/spec` package is a types-only
dependency with no runtime cost.

`valueSchema` accepts only **synchronous** schemas. The signature uses a generic
constraint that rejects any schema whose `validate` method may return a
`Promise`, so async schemas produce a compile error at the call site rather than
a runtime surprise. For async checks like "is this username taken," pair the
field with an async derivation; see
[What this does not cover](#what-this-does-not-cover).

## Table of contents

- [Basic usage](#basic-usage)
- [Type flow](#type-flow)
- [ValidationState](#validationstate)
- [Reading validation state](#reading-validation-state)
- [Initial state](#initial-state)
- [In scopes](#in-scopes)
- [Cross-field validation with validate](#cross-field-validation-with-validate)
- [Issue routing via path](#issue-routing-via-path)
- [\$getIsValid / $useIsValid](#getisvalid--useisvalid)
- [\$getValidation / $useValidation](#getvalidation--usevalidation)
- [Extending scopes with validate](#extending-scopes-with-validate)
- [Pipes and compareUsing](#pipes-and-compareusing)
- [Object schemas](#object-schemas)
- [Standalone usage](#standalone-usage)
- [Full form example](#full-form-example)

---

## Basic usage

```ts
import { type } from 'arktype';
import { valueSchema } from 'valuse';

const Email = type('string.email');

const email = valueSchema(Email, '');

email.set('alice@example.com');
email.get(); // 'alice@example.com'

email.set('not-an-email');
email.get(); // 'not-an-email', whatever was last set
email.getValidation().isValid; // false
```

The first argument is any Standard Schema-compliant schema. The second is the
default value.

`.set()` always stores what you give it. The validation state reports whether
what's stored is valid. There is no "last valid value" preserved separately;
that meta-state would make `.get()` and `$getSnapshot()` disagree with what was
just written, which is hard to reason about.

## Type flow

Types are inferred from the schema. You don't repeat them:

```ts
const View = type("'list' | 'grid'");

const view = valueSchema(View, 'list');
// view.set() accepts string (the schema's input type)
// view.get() returns string (the input type)
```

`.get()` returns the schema's **input** type, not its output type. The stored
value is whatever was last set, and there's no guarantee it satisfies the output
type. To read the validated, narrowed (or parsed) value, go through validation;
the result is a discriminated union, so the parsed `Out` is available after an
`isValid` guard.

```ts
const result = view.getValidation();
if (result.isValid) {
  result.value; // 'list' | 'grid', narrowed
}
```

For narrowing schemas where input and output coincide (like `'list' | 'grid'`,
where ArkType infers both as the same literal union), this distinction is
invisible. It matters for parsing schemas, where input and output diverge:

```ts
const Count = type('string.numeric.parse'); // string -> number

const count = valueSchema(Count, '0');
count.set('abc');
count.get(); // 'abc', typed as string

const result = count.getValidation();
if (result.isValid) {
  result.value; // number, the parsed output
} else {
  result.issues; // schema rejected the input
}
```

This keeps the type system honest. The raw input is always reachable via
`.get()`; the parsed output is reachable only when validation succeeds.

## ValidationState

Every `valueSchema` field carries a `ValidationState<In, Out>` alongside its
value. It is a discriminated union on `isValid`:

```ts
type ValidationState<In, Out> =
  | {
      readonly isValid: true;
      readonly value: Out;
      readonly issues: readonly [];
    }
  | {
      readonly isValid: false;
      readonly value: In;
      readonly issues: readonly StandardSchemaV1.Issue[];
    };
```

When valid, `value` is the schema's parsed output. When invalid, `value` is the
raw input that was last set (the same thing `.get()` returns). The discriminant
lets you write `if (validation.isValid) { validation.value /* Out */ }` and have
TypeScript narrow correctly.

Each issue follows the Standard Schema format:

```ts
interface Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
}
```

This is the same format that ArkType, Zod, Valibot, and other compliant
libraries produce. ValUse doesn't define its own error type.

## Reading validation state

Two methods, mirroring the `getAsync()` / `useAsync()` pattern:

| Method             | Returns                                     | Reactive |
| ------------------ | ------------------------------------------- | -------- |
| `.getValidation()` | `ValidationState<In, Out>`                  | No       |
| `.useValidation()` | `[value, setter, ValidationState<In, Out>]` | Yes      |

`.getValidation()` reads the current validation state without reactive tracking.
Use it in lifecycle hooks, event handlers, or anywhere outside the render path.

`.useValidation()` is a React hook. It re-renders when either the value or the
validation state changes.

```tsx
const [email, setEmail, validation] = form.email.useValidation();
```

The first two tuple slots match `.use()` exactly, so you can swap one for the
other without rewiring destructuring. The validation state is appended.

## Initial state

On instance creation, the default value is validated immediately. Validation
state reflects the result:

```ts
// valid default
{ isValid: true, value: parsedDefault, issues: [] }

// invalid default
{ isValid: false, value: rawDefault, issues: [...] }
```

A malformed default surfaces as a validation error from the start. If you want
"don't show errors until interaction" behavior, layer that on top with a
`valuePlain(false)` `touched` flag, toggled on first edit:

```ts
const form = valueScope({
  email: valueSchema(Email, ''),
  emailTouched: valuePlain(false),
});

// in your input handler:
function onEmailChange(value: string) {
  form.email.set(value);
  form.emailTouched.set(true);
}

// in render:
const validation = form.email.useValidation()[2];
const showError = form.emailTouched.get() && !validation.isValid;
```

## In scopes

`valueSchema` works in scope definitions alongside `value()`, `valuePlain()`,
and derivations:

```ts
import { type } from 'arktype';
import { valueSchema, value, valueScope } from 'valuse';

const Name = type('1 < string <= 100');
const Email = type('string.email');

const userForm = valueScope({
  name: valueSchema(Name, ''),
  email: valueSchema(Email, ''),
  newsletter: value(false), // regular reactive value, no schema
});
```

Schema fields produce `FieldValueSchema<In, Out>` on the instance, which has all
the methods of `FieldValue` (`.get()`, `.set()`, `.use()`, `.subscribe()`) plus
`.getValidation()` and `.useValidation()`.

Non-schema fields are unaffected. `newsletter` is a regular
`FieldValue<boolean>` as usual.

### Change tracking

A `.set()` always updates the value, so `onChange` and `beforeChange` fire as
they would for a regular `value()` field, regardless of validation. If you need
to react only to valid writes in a change hook, check the field's
`.getValidation().isValid` inside the hook.

This keeps the value pipeline simple and predictable: write → change. Validation
is metadata that classifies the value, not a gate that holds it back.

## Cross-field validation with `validate`

Per-field schemas handle most validation. For rules that span multiple fields,
add a `validate` config option to the scope:

```ts
const Password = type('8 <= string');

const signupForm = valueScope(
  {
    password: valueSchema(Password, ''),
    confirm: valueSchema(Password, ''),
  },
  {
    validate: ({ scope }) => {
      const issues: StandardSchemaV1.Issue[] = [];
      if (scope.password.use() !== scope.confirm.use()) {
        issues.push({ message: 'Passwords must match', path: ['confirm'] });
      }
      return issues;
    },
  },
);
```

`validate` lives in the scope config alongside `onCreate`, `onChange`, and the
other lifecycle hooks, but it isn't an event hook; it is a reactive derivation
that returns an issue list. It re-evaluates whenever a `.use()`'d dependency
changes. In the example above, changing either `password` or `confirm` triggers
a re-evaluation. The return type must be `StandardSchemaV1.Issue[]`.

You can also delegate to a schema library for cross-field rules:

```ts
const CrossFieldRules = type({
  password: 'string',
  confirm: 'string',
}).narrow((data, ctx) => {
  if (data.password !== data.confirm) {
    ctx.mustBe('matching passwords', { path: ['confirm'] });
  }
  return true;
});

{
  validate: ({ scope }) => {
    const result = CrossFieldRules['~standard'].validate({
      password: scope.password.use(),
      confirm: scope.confirm.use(),
    });
    return result.issues ?? [];
  },
}
```

This keeps all validation logic in your schema library's API. `validate` is just
the bridge.

## Issue routing via `path`

Issues from `validate` can include a `path` that maps them to specific fields.
When an issue has `path: ['confirm']`, it is merged into
`confirm.getValidation().issues`:

```ts
instance.confirm.set('short');
instance.confirm.getValidation();
// {
//   isValid: false,
//   value: 'short',
//   issues: [
//     { message: 'Must be at least 8 characters' },            // from schema
//     { message: 'Passwords must match', path: ['confirm'] },  // from validate
//   ],
// }
```

A field's validation state is the union of its own schema errors and any
`validate` errors routed to it. The UI reads one `issues` array and doesn't need
to know where each issue came from.

Issues without a `path` (or with a path that doesn't match any field) are
scope-level issues. They affect `$getIsValid()` but aren't surfaced on any
individual field.

### Routing rules

Path resolution is intentionally local. The rules:

1. **Paths are interpreted relative to the scope that owns the `validate`
   hook.** A `validate` hook in scope `S` can only route issues to `S`'s own
   immediate fields.
2. **Routing matches the first segment against `S`'s own fields.** If the first
   segment names a field on `S`, the issue is merged into that field's
   `getValidation().issues`. Otherwise it stays as a scope-level issue.
3. **Hooks do not descend into subscopes.** A parent hook returning
   `path: ['account', 'email']` does not route into the `account` subscope's
   `email` field; that issue is scope-level on the parent. To attach an issue to
   a child field, put a `validate` hook in the child scope.
4. **Deep aggregation prefixes upward but does not re-route downward.**
   `$getValidation({ deep: true })` walks subscopes and prefixes their issue
   paths with the path to that subscope (so a child's `path: ['email']` surfaces
   at the parent as `path: ['account', 'email']`), but it does not change which
   scope each issue is routed against.

This keeps every hook authoritative over its own scope and avoids surprising
action-at-a-distance from a parent hook reaching into a child field.

## `$getIsValid` / `$useIsValid`

Scope instances that contain at least one `valueSchema` field or a `validate`
config option get these methods:

| Method          | Returns   | Reactive |
| --------------- | --------- | -------- |
| `$getIsValid()` | `boolean` | No       |
| `$useIsValid()` | `boolean` | Yes      |

They check two sources:

1. All `valueSchema` fields in the scope (each field's `isValid`)
2. The `validate` hook's returned issues (if any)

Returns `true` only when both sources produce zero issues.

```ts
const instance = signupForm.create();
instance.$getIsValid(); // true, defaults assumed valid

instance.email.set('bad');
instance.$getIsValid(); // false, email schema rejected it

instance.email.set('good@example.com');
instance.$getIsValid(); // depends on validate too
```

**Shallow by default.** Only checks the current scope's own fields and
`validate`, not subscopes. Pass `{ deep: true }` to walk subscopes transitively:

```ts
form.$getIsValid(); // this scope only
form.$getIsValid({ deep: true }); // this scope + all subscopes
form.$useIsValid({ deep: true }); // same, as a React hook
```

Deep mode recursively checks every subscope that has validation sources.
Subscopes without `valueSchema` fields or `validate` are skipped.

**Throws if no validation sources exist.** Calling shallow `$getIsValid()` on a
scope with zero `valueSchema` fields and no `validate` hook is almost certainly
a mistake. It throws rather than silently returning `true`:

```
Error: $getIsValid() requires at least one valueSchema field or an validate hook.
```

Deep mode (`{ deep: true }`) does not throw on a parent without its own
validation sources, since the relevant validation may live entirely in
descendants.

In React, `$useIsValid()` re-renders only when the overall validity changes:

```tsx
function SubmitButton() {
  const form = useForm();
  const isValid = form.$useIsValid();

  return (
    <button type="submit" aria-disabled={!isValid}>
      Submit
    </button>
  );
}
```

## `$getValidation` / `$useValidation`

When a boolean isn't enough — typically because you want to render errors next
to inputs or in a summary banner — every scope instance also exposes
`$getValidation()` and `$useValidation()`. These return the full aggregated
result:

```ts
interface ScopeValidationResult {
  readonly isValid: boolean;
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
}
```

| Method                  | Returns                 | Reactive |
| ----------------------- | ----------------------- | -------- |
| `$getValidation(opts?)` | `ScopeValidationResult` | No       |
| `$useValidation(opts?)` | `ScopeValidationResult` | Yes      |

```ts
const result = instance.$getValidation();
// { isValid: false, issues: [{ message: 'Invalid email', path: ['email'] }] }

const deep = instance.$getValidation({ deep: true });
// Walks every subscope and ScopeMap entry, prefixing paths.
```

### Issue path layering

Every issue surfaces with a scope-relative `path` following these rules:

- **Per-field schema issue**: prefixed with `[fieldName, ...issue.path]`. The
  schema's own internal path (for object schemas) is preserved after the field
  name.
- **`validate` hook issue**: passes through unchanged. The author writes a
  scope-relative path; ValUse does not rewrite it.
- **Nested ref scope (deep mode)**: child issues are prefixed with the ref field
  name. An `address` ref with an issue at `['zip']` surfaces as
  `['address', 'zip']`.
- **ScopeMap entry (deep mode)**: child issues are prefixed with
  `[mapField, entryKey, ...]`. A `cards` map containing entry `'c1'` with an
  issue at `['title']` surfaces as `['cards', 'c1', 'title']`.

`$getValidation()`'s `isValid` is just `issues.length === 0`, so the boolean and
the issue list never disagree. The lighter-weight `$getIsValid()` is still
useful when you only need the gate — it short-circuits on the first failure and
skips issue construction.

**Deduplication.** A `validate` hook issue routed to a field via its `path`
shows up on `field.useValidation()` (merged into that field's own issues) but
the scope-level `$getValidation()` emits it exactly once.

## Extending scopes with `validate`

When a scope with `validate` is extended and the extension also provides
`validate`, both run. This follows the same pattern as other lifecycle hooks:
base runs first, then extension. Issues are concatenated, not deduped.

```ts
const baseForm = valueScope(
  { email: valueSchema(Email, '') },
  {
    validate: ({ scope }) => {
      // base rules
    },
  },
);

const extendedForm = baseForm.extend(
  {
    password: valueSchema(Password, ''),
    confirm: valueSchema(Password, ''),
  },
  {
    validate: ({ scope }) => {
      const issues: StandardSchemaV1.Issue[] = [];
      if (scope.password.use() !== scope.confirm.use()) {
        issues.push({ message: 'Passwords must match', path: ['confirm'] });
      }
      return issues;
    },
  },
);
```

`$getIsValid()` and `$getValidation()` both pull from all sources: per-field
schema validation, base `validate`, and extension `validate`. If both hooks
produce the same issue, both appear in `$getValidation().issues`. Deduping
across the base/extension boundary is the caller's responsibility.

## Pipes and `compareUsing`

`valueSchema` supports `.pipe()` and `.compareUsing()`. Pipes run on the raw
input _before_ validation; validation is the final classification step:

```ts
const email = valueSchema(Email, '').pipe((v: string) => v.toLowerCase());

email.set('ALICE@EXAMPLE.COM');
// 1. Pipe runs: lowercases → 'alice@example.com'
// 2. Schema validates: passes
// 3. email.get() → 'alice@example.com'
// 4. email.getValidation().isValid → true

email.set('  bad  ');
// 1. Pipe runs: lowercases → '  bad  '
// 2. Schema validates: fails
// 3. email.get() → '  bad  '
// 4. email.getValidation().isValid → false
```

`.compareUsing()` runs as part of the write step, same as `value()`:

```ts
const user = valueSchema(UserSchema, defaultUser).compareUsing(
  (a, b) => a.id === b.id,
);
```

Pipeline order: `.set()` -> pipe chain -> compareUsing -> write -> validate. If
`compareUsing` reports the new value as equal to the current one, both the write
and the validate steps are skipped. Validation is a pure function of the stored
value, so an unchanged value yields an unchanged validation state.

## Object schemas

`valueSchema` accepts object schemas. The entire object is validated as a unit:

```ts
const UserInput = type({
  name: '1 < string <= 100',
  email: 'string.email',
  age: '1 <= number <= 150',
});

const user = valueSchema(UserInput, { name: '', email: '', age: 18 });

user.set({ name: 'Alice', email: 'bad', age: 25 });
user.get(); // { name: 'Alice', email: 'bad', age: 25 }
user.getValidation(); // { isValid: false, value: {...}, issues: [...] }
```

One signal, one validation pass, all-or-nothing. No per-field reactivity or
per-field error messages. This is useful for simple cases where you just need
"is this blob valid?" without the overhead of a full scope.

The per-field scope version (one `valueSchema` per field) is the upgrade path
when you need granular reactivity and individual error display.

## Standalone usage

Like `value()`, `valueSchema` works outside scopes:

```ts
const email = valueSchema(Email, '');

email.set('bad');
email.get(); // 'bad'
email.getValidation();
// { isValid: false, value: 'bad', issues: [...] }

email.subscribe((value, prev) => {
  console.log(`${prev} → ${value}`);
});
```

All the same methods work: `.get()`, `.set()`, `.use()`, `.subscribe()`,
`.getValidation()`, `.useValidation()`. The only thing you don't get outside a
scope is `$getIsValid()` / `$useIsValid()` / `$getValidation()` /
`$useValidation()` and `validate` (those are scope-level features).

## Full form example

A signup form with per-field validation, cross-field validation, and
field-isolated React components:

```ts
import { type } from 'arktype';
import { valueSchema, valueScope } from 'valuse';
import type { StandardSchemaV1 } from '@standard-schema/spec';

const Name = type('1 < string <= 100');
const Email = type('string.email');
const Password = type('8 <= string');

const signupForm = valueScope(
  {
    name: valueSchema(Name, ''),
    email: valueSchema(Email, ''),
    password: valueSchema(Password, ''),
    confirm: valueSchema(Password, ''),
  },
  {
    validate: ({ scope }) => {
      const issues: StandardSchemaV1.Issue[] = [];
      if (scope.password.use() !== scope.confirm.use()) {
        issues.push({ message: 'Passwords must match', path: ['confirm'] });
      }
      return issues;
    },
  },
);
```

Each field gets its own component. Components subscribe only to the fields they
read, so typing in one field doesn't re-render the others:

```tsx
function TextField({
  field,
  label,
  type = 'text',
}: {
  field: FieldValueSchema<string, string>;
  label: string;
  type?: string;
}) {
  const [value, setValue, validation] = field.useValidation();

  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={!validation.isValid || undefined}
      />
      {!validation.isValid && (
        <span role="alert" className="error">
          {validation.issues[0]?.message}
        </span>
      )}
    </label>
  );
}

function SignupPage() {
  const [form] = useState(() => signupForm.create());

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.$getIsValid()) return;
    api.signup(form.$getSnapshot());
  };

  return (
    <form onSubmit={handleSubmit}>
      <TextField field={form.name} label="Name" />
      <TextField field={form.email} label="Email" type="email" />
      <TextField field={form.password} label="Password" type="password" />
      <TextField
        field={form.confirm}
        label="Confirm password"
        type="password"
      />
      <SubmitButton form={form} />
    </form>
  );
}

function SubmitButton({ form }) {
  const isValid = form.$useIsValid();

  return (
    <button type="submit" aria-disabled={!isValid}>
      Create account
    </button>
  );
}
```

What's happening:

- **Per-field isolation.** Each `TextField` calls `.useValidation()` on one
  field. Typing in the name input doesn't re-render the email input.
- **Unified error display.** The confirm field shows both schema errors ("Must
  be at least 8 characters") and cross-field errors ("Passwords must match")
  from the same `validation.issues` array.
- **Reactive submit button.** `$useIsValid()` re-renders the button only when
  overall validity changes. `aria-disabled` keeps the button focusable for
  screen readers.
- **Sync submit handler.** `$getIsValid()` (non-reactive) for the submit guard,
  `$getSnapshot()` for the payload. No async, no extra state.

## What this does not cover

**Async validation** (checking if a username is taken, verifying an invite
code). This requires loading states, debouncing, and cancellation. A future
`valueSchemaAsync` could handle this by building on the async derivation
machinery. For now, use an async derivation alongside the schema field:

```ts
const form = valueScope({
  username: valueSchema(Username, ''),

  usernameAvailable: async ({ scope, signal }) => {
    const name = scope.username.use();
    if (!name) return true;
    await asyncDelay({ ms: 300, signal });
    const res = await fetch(`/api/check-username?name=${name}`, { signal });
    return res.json();
  },
});
```

**Dirty/touched tracking.** This is orthogonal to validation. A simple approach
is a `valuePlain(false)` toggled on first interaction, or a scope-level
`isDirty` derivation that compares current values to their initial state.
