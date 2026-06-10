# Extending Scopes

`.extendValues()` and `.extendConfig()` create new scope templates that build on
a base, adding values, [derivations](derivations.md), and
[lifecycle hooks](lifecycle.md) without mutating the original. Together they are
the primary mechanism for composition, specialization, and middleware in ValUse.

The split mirrors `valueScope()`'s variadic shape, with intent baked into the
method name:

- `.extendValues(values, deriv1?, deriv2?, …)` adds or overrides values and
  derivations. Variadic, same slot structure as `valueScope()` minus the
  trailing config slot.
- `.extendConfig(config)` attaches lifecycle hooks. The definition is unchanged;
  only the config is merged.

## Table of contents

- [Basic extension](#basic-extension)
- [Adding derivations](#adding-derivations)
- [Overriding values](#overriding-values)
- [Removing values](#removing-values)
- [Lifecycle hook merging](#lifecycle-hook-merging)
- [Middleware pattern](#middleware-pattern)
- [Chaining extensions](#chaining-extensions)
- [Type inference](#type-inference)
- [Public widening types](#public-widening-types)

---

## Basic extension

The simplest extend adds new values to a base. Pass a values layer; the result
is a new `ScopeTemplate` with the merged definition:

```ts
const chatMessage = valueScope({
  body: value<string>(),
  sentAt: value<number>(0),
});

const channelMessage = chatMessage.extendValues({
  channelId: value<string>(),
  threadId: value<string | null>(null),
});

const msg = channelMessage.create({
  body: 'Hello!',
  sentAt: Date.now(),
  channelId: 'general',
});

msg.body.get(); // 'Hello!', inherited from chatMessage
msg.channelId.get(); // 'general', added by extension
msg.threadId.get(); // null, default from extension
```

The extended template is fully independent from the base. Creating an instance
of `channelMessage` does not affect `chatMessage` or its instances.

## Adding derivations

Extensions can add derivations that reference base and newly-added values. Like
`valueScope()`, values and derivations live in separate layers:

```ts
const channelMessage = chatMessage.extendValues(
  { channelId: value<string>() },
  {
    label: ({ scope }) => `[${scope.channelId.use()}] ${scope.body.use()}`,
  },
);
```

If you only need to add derivations, pass a derivation layer alone. Slot 1 of
`.extendValues()` can be either a values layer or a derivation layer against the
base:

```ts
const withPreview = chatMessage.extendValues({
  preview: ({ scope }) => scope.body.use().slice(0, 80),
});
```

The first argument is discriminated by content: entries that are reactive
primitives (`value`, `valueRef`, etc.) make it a values layer; entries that are
functions make it a derivation layer. A single layer cannot mix the two.

For multi-arg calls, slot 1 must be a values layer (which may be empty). To add
multiple derivation layers without new values, pass an empty values layer first:

```ts
const layered = chatMessage.extendValues(
  {}, // empty values layer
  {
    preview: ({ scope }) => scope.body.use().slice(0, 80),
  },
  {
    previewWithEllipsis: ({ scope }) =>
      scope.preview.use().length < scope.body.use().length ?
        scope.preview.use() + '…'
      : scope.preview.use(),
  },
);
```

Siblings defined in the same derivation layer are not visible to one another (by
design; sibling references run from the next layer). Self-references (a
derivation that reads the value it's replacing in the same layer) are caught at
runtime by cycle detection on first evaluation, not at compile time.

## Overriding values

Extension keys that match base keys replace them:

```ts
const base = valueScope({
  status: value('draft'),
  priority: value(0),
});

const urgent = base.extendValues({
  priority: value(10), // replaces base priority, new default is 10
});
```

The override replaces the entire definition entry. If the base had a
`value<string>()` and you override with a derivation function, the entry becomes
a derivation.

A derivation that overrides a base key cannot read `scope.<sameKey>` to access
the previous value; the override is total. If you need a "transform existing
value" pattern, redefine the value with a [pipe](pipes.md) instead of an
override:

```ts
// Transform incoming values with a pipe, not a derivation override.
const upper = base.extendValues({
  status: value('draft').pipe((s) => s.toUpperCase()),
});
```

## Removing values

Set a key to `undefined` to remove it from the definition:

```ts
const full = valueScope({
  body: value<string>(),
  sentAt: value(0),
  debug: value(''),
});

const production = full.extendValues({
  debug: undefined, // removed, not on the instance
});

const msg = production.create({ body: 'Hello' });
// msg.debug, does not exist
// TypeScript catches references to removed values
```

Removal is useful for stripping development-only values or simplifying a scope
for a specific context.

## Lifecycle hook merging

`.extendConfig()` attaches hooks. When both the base and the extension define
hooks, both fire in order (base first, then extension):

```ts
const base = valueScope(
  { roomId: value<string>() },
  {
    onCreate: ({ scope }) => console.log('base onCreate:', scope.roomId.get()),
    onDestroy: ({ scope }) => console.log('base onDestroy'),
  },
);

const extended = base.extendValues({ topic: value('General') }).extendConfig({
  onCreate: ({ scope }) => console.log('ext onCreate:', scope.topic.get()),
  onDestroy: () => console.log('ext onDestroy'),
});

const room = extended.create({ roomId: 'r1', topic: 'Announcements' });
// logs: base onCreate: r1
// logs: ext onCreate: Announcements

room.$destroy();
// logs: base onDestroy
// logs: ext onDestroy
```

All hook types merge this way: `onCreate`, `onDestroy`, `onChange`,
`beforeChange`, `onUsed`, and `onUnused`. For details on each hook, see
[Lifecycle](lifecycle.md) and [Change hooks](change-hooks.md).

If only one side defines a hook, it runs alone. The ordering guarantee is always
base before extension, even through multiple levels of chaining.

## Middleware pattern

Since `.extendValues()` / `.extendConfig()` take a template and return a
template, middleware is just a function:

```ts
function withTimestamps<Def extends Record<string, unknown>>(
  scope: ScopeTemplate<Def>,
) {
  return scope
    .extendValues({
      createdAt: value(Date.now()),
      updatedAt: value(Date.now()),
    })
    .extendConfig({
      onChange: ({ scope }) => {
        // The `Def` generic doesn't know about the fields this middleware
        // adds, so the cast is the price of staying generic over the base.
        (scope as any).updatedAt.set(Date.now());
      },
    });
}

function withSoftDelete<Def extends Record<string, unknown>>(
  scope: ScopeTemplate<Def>,
) {
  return scope.extendValues({
    isDeleted: value(false),
    deletedAt: value<number | null>(null),
  });
}
```

Apply middleware by composing:

```ts
const chatMessage = valueScope({
  body: value<string>(),
  channelId: value<string>(),
});

const trackedMessage = withSoftDelete(withTimestamps(chatMessage));

const msg = trackedMessage.create({ body: 'Hello', channelId: 'general' });
msg.createdAt.get(); // timestamp
msg.isDeleted.get(); // false
```

Middleware composes naturally because each step returns a valid `ScopeTemplate`.
Order matters: hooks from earlier middleware run before later ones.

For middleware that **attaches new `$`-methods or otherwise treats the scope
generically**, see [Public widening types](#public-widening-types) below.

## Chaining extensions

Extensions can be chained without limit:

```ts
const base = valueScope({ id: value<string>() });

const withChannel = base.extendValues({
  channelId: value<string>(),
  roomId: value<string>(),
});

const withMetadata = withChannel.extendValues({
  sentAt: value(0),
  editedAt: value<number | null>(null),
});

const withLabel = withMetadata.extendValues({
  label: ({ scope }) => `[${scope.channelId.use()}] message ${scope.id.use()}`,
});
```

Each step produces a new, independent template. The final template includes all
values and hooks from every step in the chain.

## Type inference

TypeScript tracks the full merged type through extensions:

```ts
const chatMessage = valueScope({
  body: value<string>(),
  sentAt: value(0),
});

const extended = chatMessage.extendValues({
  channelId: value<string>(),
  sentAt: undefined, // removed
});

const msg = extended.create({ body: 'Hello', channelId: 'general' });
msg.body.get(); // string | undefined
msg.channelId.get(); // string
// msg.sentAt, type error, removed by extension
```

If you are writing generic middleware functions, you may need to type the
template parameter as `ScopeTemplate<Def>` with a constraint:

```ts
import type { ScopeTemplate } from 'valuse';

function withFeature<Def extends Record<string, unknown>>(
  scope: ScopeTemplate<Def>,
) {
  return scope.extendValues({ feature: value(true) });
}
```

The return type automatically includes all of `Def` plus
`{ feature: Value<boolean> }`.

## Public widening types

For middleware that operates on templates without knowing their concrete shape,
ValUse exposes typed helpers that avoid raw `as any` casts:

- `UnknownValueScope` is an alias for `ScopeTemplate<Record<string, unknown>>`.
  Use as a cast target inside middleware that attaches `$`-methods or reads
  snapshots without knowing the definition shape.
- `ValueScope<RequiredDef>` is a definition-shape constraint helper. Apply as
  `Def extends ValueScope<{ field: Value<…> }>` to require that the input
  template includes specific values.
- `asUnknownValueScope(template)` is a typed cast helper returning
  `UnknownValueScope`. Equivalent to `template as UnknownValueScope` but
  self-documenting at the call site.

The cast widens `Def` to `Record<string, unknown>`, which makes `HookScope<Def>`
resolve eagerly to `GenericScopeInstance`. Inside hooks, the scope picks up an
index signature for dynamic property writes:

```ts
import { asUnknownValueScope } from 'valuse';

function withUndo<Def extends Record<string, unknown>>(
  template: ScopeTemplate<Def>,
) {
  return asUnknownValueScope(template).extendConfig({
    onCreate: ({ scope }) => {
      // `scope` is `GenericScopeInstance` here, so writes type-check.
      scope.$undo = () => {
        /* … */
      };
    },
  }) as unknown as ScopeTemplate<Def>;
}
```

For middleware that **requires specific values on the input**, combine the
constraint with `asUnknownValueScope` if you also need to attach methods:

```ts
import type { Value } from 'valuse';
import { asUnknownValueScope, type ValueScope } from 'valuse';

function withUnreadBadge<
  Def extends ValueScope<{ unreadCount: Value<number> }>,
>(template: ScopeTemplate<Def>) {
  // The constraint validates that the input declares `unreadCount` at the call
  // site. Inside the hook, `scope` is still generic; read typed values
  // via `$getSnapshot()` or by casting to a known shape.
  return template.extendConfig({
    onChange: ({ scope }) => {
      const snap = scope.$getSnapshot();
      console.log(snap.unreadCount);
    },
  });
}
```
