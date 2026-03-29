# Example: Multi-Step Form Wizard

A multi-step form with per-field validation, cross-field rules, and a dynamic
schema-driven step. This showcases `extend()`, `onChange`, and
`allowUndeclaredProperties`.

## The model

Start with a base field scope. Every field tracks its value, touched state, and validation:

```ts
import { value, valueScope } from "valuse";

const field = <T>(initial: T, validate: (v: T) => string | null) =>
  valueScope(
    {
      value: value<T>(initial),
      initialValue: value<T>(initial),
      isTouched: value<boolean>(false),
      error: value<string | null>(null),

      isDirty: (get) => get("value") !== get("initialValue"),
    },
    {
      onInit: (set, get) => {
        set("initialValue", get("value"));
      },
      onChange: (changes, set, get, getSnapshot) => {
        const valueChanged = changes.some((c) => c.key === "value");
        if (!valueChanged) return;

        // Run validation on every value change
        const err = validate(get("value"));
        set("error", err);
      },
    },
  );
```

Now define each step of the wizard by composing fields:

```ts
// Step 1: Account info
const accountStep = valueScope({
  email: field("", (v) => (!v.includes("@") ? "Invalid email" : null)),
  password: field("", (v) => (v.length < 8 ? "Min 8 characters" : null)),
  confirmPassword: field("", () => null), // cross-field validation below
});

// Step 2: Personal info
const personalStep = valueScope({
  firstName: field("", (v) => (!v.trim() ? "Required" : null)),
  lastName: field("", (v) => (!v.trim() ? "Required" : null)),
  phone: field("", (v) => (v && !/^\+?\d{10,}$/.test(v) ? "Invalid phone" : null)),
});

// Step 3: Preferences — schema-driven, dynamic fields
const prefsStep = valueScope(
  {
    theme: field<"light" | "dark">("light", () => null),
    notifications: field(true, () => null),
  },
  {
    // Extra fields can come from a CMS or feature flags
    allowUndeclaredProperties: true,
  },
);
```

### The wizard itself

```ts
const wizard = valueScope(
  {
    currentStep: value<number>(0),
    account: valueRef(accountStep.create()),
    personal: valueRef(personalStep.create()),
    prefs: valueRef(prefsStep.create()),

    stepCount: () => 3,

    canGoBack: (get) => get("currentStep") > 0,
    canGoForward: (get) => get("currentStep") < get("stepCount") - 1,

    // Aggregate validation across all steps
    isValid: (get) => {
      const [account, personal, prefs] = get(["account", "personal", "prefs"]);
      // Each step is a ScopeInstance — check its fields for errors
      return [account, personal, prefs].every((step) =>
        Object.keys(step.getSnapshot()).every((key) => {
          const field = step.get(key);
          return !field?.get?.("error");
        }),
      );
    },
  },
  {
    onChange: (changes, set, get, getSnapshot) => {
      // Auto-save draft on step change
      if (changes.some((c) => c.key === "currentStep")) {
        saveDraft();
      }
    },
  },
);
```

## React components

```tsx
import { useMemo } from "react";
import { value, valueScope, type ScopeInstance } from "valuse/react";

// Infer the instance type from the field factory
type WizardForm = ReturnType<typeof wizard.create>;
type FieldInstance = ReturnType<ReturnType<typeof field>["create"]>;

function Wizard() {
  // Create once — useMemo ensures the instance survives re-renders
  const form = useMemo(() => wizard.create(), []);
  const [currentStep] = form.use("currentStep");

  return (
    <div>
      {currentStep === 0 && <AccountStep form={form} />}
      {currentStep === 1 && <PersonalStep form={form} />}
      {currentStep === 2 && <PrefsStep form={form} />}
      <WizardNav form={form} />
    </div>
  );
}

function AccountStep({ form }: { form: WizardForm }) {
  // These are plain reads, not subscriptions — this component doesn't re-render.
  // It just resolves the refs and passes field instances to FormField,
  // which subscribes via field.use().
  const account = form.get("account");
  const emailField = account.get("email");
  const passwordField = account.get("password");

  return (
    <div>
      <h2>Account</h2>
      <FormField field={emailField} label="Email" type="email" />
      <FormField field={passwordField} label="Password" type="password" />
    </div>
  );
}

function WizardNav({ form }: { form: WizardForm }) {
  // Per-field use() — only re-renders when these specific fields change,
  // not when unrelated fields (like account.email) change.
  // Derived fields return [value], value fields return [value, setter].
  const [canGoBack] = form.use("canGoBack"); // [boolean] — derived, read-only
  const [canGoForward] = form.use("canGoForward"); // [boolean] — derived, read-only
  const [currentStep, setStep] = form.use("currentStep"); // [number, setter]
  const [stepCount] = form.use("stepCount"); // [number] — derived, read-only

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

function FormField({
  field,
  label,
  type = "text",
}: {
  field: FieldInstance;
  label: string;
  type?: string;
}) {
  // Fully typed ScopeInstance —
  // get("value"), get("error"), set("isTouched") are all type-checked
  const [get, set] = field.use();

  return (
    <div>
      <label>{label}</label>
      <input
        type={type}
        value={get("value")}
        onChange={(e) => set("value", e.target.value)}
        onBlur={() => set("isTouched", true)}
      />
      {get("isTouched") && get("error") && <span className="error">{get("error")}</span>}
    </div>
  );
}
```

## extend() for step variants

Say some users see an "Organization" step between Account and Personal. Use `extend()` to add fields without duplicating the base:

```ts
const orgStep = personalStep.extend(
  {
    orgName: field("", (v) => (!v.trim() ? "Required" : null)),
    orgSize: field<"small" | "medium" | "large">("small", () => null),
    taxId: field("", (v) => (v && v.length < 9 ? "Invalid tax ID" : null)),
  },
  {
    onChange: (changes, set, get, getSnapshot) => {
      // When org size changes, maybe adjust required fields
    },
  },
);
```

`orgStep` has all of `personalStep`'s fields (firstName, lastName, phone) plus the org-specific ones. Lifecycle hooks from both are merged — `personalStep`'s onChange runs first, then `orgStep`'s.

## allowUndeclaredProperties for dynamic forms

The preferences step has a fixed set of known fields, but a CMS might add more at runtime:

```ts
// API returns extra preference fields
const extraPrefs = await fetch("/api/user-prefs-schema");
// { newsletter: true, betaFeatures: false, language: "en" }

const prefsInstance = prefsStep.create({
  theme: userTheme,
  notifications: true,
  // Dynamic fields from API — preserved as passthrough
  ...extraPrefs,
});

// Read them back
prefsInstance.get("newsletter"); // true
prefsInstance.get("language"); // "en"
```

The known fields (`theme`, `notifications`) are reactive — changing them triggers `onChange` and re-renders. The dynamic fields are preserved and accessible but non-reactive. This is the sweet spot for forms where the schema comes from an external source.

## Submission

```ts
async function submit(form: ReturnType<typeof wizard.create>) {
  // getSnapshot() captures everything — values, derivations, passthrough data
  const [account, personal, prefs] = form.get(["account", "personal", "prefs"]);

  const payload = {
    account: account.getSnapshot(),
    personal: personal.getSnapshot(),
    prefs: prefs.getSnapshot(),
  };

  await fetch("/api/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
```

## Why this is hard in other libraries

**Zustand**: A multi-step form either lives in one giant store (every field in a flat namespace) or multiple stores that can't easily share validation state. No `extend()` — adding an org step means duplicating the personal step's logic.

**Jotai**: Each field is an atom. Cross-field validation (password === confirmPassword) requires derived atoms that watch multiple sources. There's no "step" as a unit — it's atoms all the way down. Dynamic fields from an API? You'd need `atomFamily` with dynamic keys and manual cleanup.

**ValUse**: Each field is a scope. Each step is a scope of field-scopes. The
wizard is a scope of step-refs. Validation lives in `onChange`. Dynamic fields
use `allowUndeclaredProperties`. Step variants use `extend()`. It's scopes all
the way down — and every level has the same API.
