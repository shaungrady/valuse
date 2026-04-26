# Extending Scopes

`.extend()` creates a new scope template that includes everything from the base
plus new fields, [derivations](derivations.md), and
[lifecycle hooks](lifecycle.md). It is the primary mechanism for composition,
specialization, and middleware in ValUse.

## Table of contents

- [Basic extension](#basic-extension)
- [Adding derivations](#adding-derivations)
- [Overriding fields](#overriding-fields)
- [Removing fields](#removing-fields)
- [Lifecycle hook merging](#lifecycle-hook-merging)
- [Middleware pattern](#middleware-pattern)
- [Chaining extensions](#chaining-extensions)
- [Type inference](#type-inference)

---

## Basic extension

`.extend()` takes a definition object and an optional config, and returns a new
`ScopeTemplate`:

```ts
const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
});

const employee = person.extend({
  title: value<string>(),
  salary: value(50000),
});

const bob = employee.create({
  firstName: 'Bob',
  lastName: 'Jones',
  title: 'Engineer',
});

bob.firstName.get(); // 'Bob' — inherited from person
bob.title.get(); // 'Engineer' — added by extension
bob.salary.get(); // 50000 — default from extension
```

The extended template is fully independent from the base. Creating an instance
of `employee` does not affect `person` or its instances.

## Adding derivations

Extensions can add derivations that reference base fields:

```ts
const employee = person.extend({
  title: value<string>(),
  label: ({ scope }) =>
    `${scope.firstName.use()} ${scope.lastName.use()} — ${scope.title.use()}`,
});
```

The derivation has access to all fields: both inherited and new. The scope
context merges the complete definition.

## Overriding fields

Extension keys that match base keys replace them:

```ts
const base = valueScope({
  status: value('draft'),
  priority: value(0),
});

const urgent = base.extend({
  priority: value(10), // replaces base priority, new default is 10
});
```

The override replaces the entire definition entry. If the base had a
`value<string>()` and you override with a derivation function, the field becomes
a derivation.

## Removing fields

Set a key to `undefined` to remove it from the definition:

```ts
const full = valueScope({
  name: value<string>(),
  age: value(0),
  debug: value(''),
});

const production = full.extend({
  debug: undefined, // removed — not on the instance
});

const inst = production.create({ name: 'Alice' });
// inst.debug — does not exist
// TypeScript catches references to removed fields
```

Removal is useful for stripping development-only fields or simplifying a scope
for a specific context.

## Lifecycle hook merging

When both the base and extension define lifecycle hooks, both fire in order
(base first, then extension):

```ts
const base = valueScope(
  { name: value<string>() },
  {
    onCreate: ({ scope }) => console.log('base onCreate:', scope.name.get()),
    onDestroy: ({ scope }) => console.log('base onDestroy'),
  },
);

const extended = base.extend(
  { role: value('viewer') },
  {
    onCreate: ({ scope }) => console.log('ext onCreate:', scope.role.get()),
    onDestroy: () => console.log('ext onDestroy'),
  },
);

const inst = extended.create({ name: 'Alice', role: 'admin' });
// logs: base onCreate: Alice
// logs: ext onCreate: admin

inst.$destroy();
// logs: base onDestroy
// logs: ext onDestroy
```

All hook types merge this way: `onCreate`, `onDestroy`, `onChange`,
`beforeChange`, `onUsed`, and `onUnused`. For details on each hook, see
[Lifecycle](lifecycle.md) and [Change hooks](change-hooks.md).

If only one side defines a hook, it runs alone. The ordering guarantee is always
base before extension, even through multiple levels of chaining.

## Middleware pattern

Since `.extend()` takes a scope and returns a scope, middleware is just a
function:

```ts
function withTimestamps<T extends Record<string, unknown>>(
  scope: ScopeTemplate<T>,
) {
  return scope.extend(
    {
      createdAt: value(Date.now()),
      updatedAt: value(Date.now()),
    },
    {
      onChange: ({ scope }) => {
        (scope as any).updatedAt.set(Date.now());
      },
    },
  );
}

function withSoftDelete<T extends Record<string, unknown>>(
  scope: ScopeTemplate<T>,
) {
  return scope.extend({
    isDeleted: value(false),
    deletedAt: value<number | null>(null),
  });
}
```

Apply middleware by composing:

```ts
const person = valueScope({
  firstName: value<string>(),
  lastName: value<string>(),
});

const trackedPerson = withSoftDelete(withTimestamps(person));

const bob = trackedPerson.create({ firstName: 'Bob', lastName: 'Jones' });
bob.createdAt.get(); // timestamp
bob.isDeleted.get(); // false
```

Middleware composes naturally because each step returns a valid `ScopeTemplate`.
Order matters: hooks from earlier middleware run before later ones.

## Chaining extensions

Extensions can be chained without limit:

```ts
const base = valueScope({ id: value<string>() });

const withName = base.extend({
  firstName: value<string>(),
  lastName: value<string>(),
});

const withJob = withName.extend({
  title: value<string>(),
  salary: value(0),
});

const withLabel = withJob.extend({
  label: ({ scope }) =>
    `${scope.firstName.use()} ${scope.lastName.use()} — ${scope.title.use()}`,
});
```

Each step produces a new, independent template. The final template includes all
fields and hooks from every step in the chain.

## Type inference

TypeScript tracks the full merged type through extensions. The `ExtendDef` type
merges base and extension, with `undefined` values removing keys:

```ts
const person = valueScope({
  name: value<string>(),
  age: value(0),
});

const extended = person.extend({
  role: value('viewer'),
  age: undefined, // removed
});

const inst = extended.create({ name: 'Alice', role: 'admin' });
inst.name.get(); // string | undefined
inst.role.get(); // string
// inst.age — type error, removed by extension
```

If you are writing generic middleware functions, you may need to type the scope
parameter as `ScopeTemplate<T>` with a constraint:

```ts
import type { ScopeTemplate } from 'valuse';

function withFeature<Def extends Record<string, unknown>>(
  scope: ScopeTemplate<Def>,
) {
  return scope.extend({ feature: value(true) });
}
```

The return type automatically includes all of `Def` plus
`{ feature: Value<boolean> }`.
