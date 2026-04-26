# Example: Multi-Step Form Wizard

A multi-step form with schema validation, cross-field rules, and step
composition. This showcases `valueSchema` for per-field validation, `extend()`
for step variants, and `validate` for cross-field rules.

See [Schema Validation](../docs/schema-validation.md) for the full `valueSchema`
API.

## The model

Each field uses `valueSchema` with a Standard Schema validator. Validation state
is tracked automatically, including per-field issues and a scope-wide
`$getIsValid()` check.

```ts
import { type } from 'arktype';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { value, valueSchema, valueScope, valueRef } from 'valuse';

// Step 1: Account info
const accountStep = valueScope(
  {
    email: valueSchema(type('string.email'), ''),
    password: valueSchema(type('string >= 8'), ''),
    confirmPassword: valueSchema(type('string >= 8'), ''),
  },
  {
    validate: ({ scope }) => {
      const issues: StandardSchemaV1.Issue[] = [];
      if (scope.password.use() !== scope.confirmPassword.use()) {
        issues.push({
          message: 'Passwords must match',
          path: ['confirmPassword'],
        });
      }
      return issues;
    },
  },
);

// Step 2: Personal info
const personalStep = valueScope({
  firstName: valueSchema(type('string > 0'), ''),
  lastName: valueSchema(type('string > 0'), ''),
  phone: valueSchema(
    type('string').pipe((v) => {
      if (v && !/^\+?\d{10,}$/.test(v)) return type.errors('Invalid phone');
      return v;
    }),
    '',
  ),
});

// Step 3: Preferences
const prefsStep = valueScope({
  theme: valueSchema(type("'light' | 'dark'"), 'light'),
  notifications: value<boolean>(true),
});
```

### The wizard itself

```ts
const wizard = valueScope({
  currentStep: value<number>(0),
  account: valueRef(accountStep),
  personal: valueRef(personalStep),
  prefs: valueRef(prefsStep),

  stepCount: () => 3,

  canGoBack: ({ scope }) => scope.currentStep.use() > 0,
  canGoForward: ({ scope }) =>
    scope.currentStep.use() < scope.stepCount.use() - 1,
});
```

## React components

### Wizard.tsx

```tsx
import { useEffect } from 'react';
import { value } from 'valuse';

// Shared reactive reference to the form instance
export const wizardForm = value<ReturnType<typeof wizard.create>>();

export function Wizard() {
  useEffect(() => {
    wizardForm.set(wizard.create());
    return () => wizardForm.get()?.$destroy();
  }, []);

  const [form] = wizardForm.use();
  if (!form) return null;

  const [currentStep] = form.currentStep.use();

  return (
    <div>
      {currentStep === 0 && <AccountStep />}
      {currentStep === 1 && <PersonalStep />}
      {currentStep === 2 && <PrefsStep />}
      <WizardNav />
    </div>
  );
}
```

### AccountStep.tsx

```tsx
import { wizardForm } from './Wizard';

function AccountStep() {
  const form = wizardForm.get();
  if (!form) return null;

  const account = form.account.get();

  return (
    <div>
      <h2>Account</h2>
      <SchemaField field={account.email} label="Email" type="email" />
      <SchemaField field={account.password} label="Password" type="password" />
      <SchemaField
        field={account.confirmPassword}
        label="Confirm Password"
        type="password"
      />
    </div>
  );
}
```

### WizardNav.tsx

```tsx
import { wizardForm } from './Wizard';

function WizardNav() {
  const form = wizardForm.get();
  if (!form) return null;

  const [canGoBack] = form.canGoBack.use();
  const [canGoForward] = form.canGoForward.use();
  const [stepCount] = form.stepCount.use();
  const [currentStep, setStep] = form.currentStep.use();

  return (
    <div>
      <button disabled={!canGoBack} onClick={() => setStep((s) => s - 1)}>
        Back
      </button>
      <span>
        Step {currentStep + 1} of {stepCount}
      </span>
      <button disabled={!canGoForward} onClick={() => setStep((s) => s + 1)}>
        Next
      </button>
    </div>
  );
}
```

### SchemaField.tsx

A reusable field component that reads validation state from `valueSchema`:

```tsx
import type { FieldValueSchema } from 'valuse';

function SchemaField({
  field,
  label,
  type = 'text',
}: {
  field: FieldValueSchema<string, string>;
  label: string;
  type?: string;
}) {
  const [fieldValue, setField, validation] = field.useValidation();

  return (
    <div>
      <label>{label}</label>
      <input
        type={type}
        value={fieldValue}
        onChange={(e) => setField(e.target.value)}
      />
      {!validation.isValid && (
        <ul className="errors">
          {validation.issues.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

## extend() for step variants

Say some users see an "Organization" step between Account and Personal. Use
`extend()` to add fields without duplicating the base:

```ts
const orgStep = personalStep.extend({
  orgName: valueSchema(type('string > 0'), ''),
  orgSize: valueSchema(type("'small' | 'medium' | 'large'"), 'small'),
  taxId: valueSchema(
    type('string').pipe((v) => {
      if (v && v.length < 9) return type.errors('Invalid tax ID');
      return v;
    }),
    '',
  ),
});
```

`orgStep` has all of `personalStep`'s fields (firstName, lastName, phone) plus
the org-specific ones. `$getIsValid()` checks all fields from both the base and
extension. See [Extending Scopes](../docs/extending.md) for more.

## Submission

```ts
async function submit() {
  const form = wizardForm.get()!;

  // Walk the wizard + all step refs in one call
  if (!form.$getIsValid({ deep: true })) return;

  await fetch('/api/register', {
    method: 'POST',
    body: JSON.stringify(form.$getSnapshot()),
  });
}
```

## Why this is hard in other libraries

**Zustand**: A multi-step form either lives in one giant store (every field in a
flat namespace) or multiple stores that can't easily share validation state. No
`extend()` means adding an org step duplicates the personal step's logic.

**Jotai**: Each field is an atom. Cross-field validation (password ===
confirmPassword) requires derived atoms that watch multiple sources. There's no
"step" as a unit. Dynamic fields from an API require `atomFamily` with dynamic
keys and manual cleanup.

**ValUse**: Each field is a `valueSchema` with automatic validation. Each step
is a scope. The wizard is a scope of step-refs. Cross-field rules use
`validate`. Step variants use `extend()`. `$getIsValid()` aggregates everything.
