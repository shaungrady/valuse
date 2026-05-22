import { type } from 'arktype';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { value, valueScope, valueRef, valueSchema } from 'valuse';

// ── Per-step scopes ────────────────────────────────────────────────────

export const accountStep = valueScope(
	{
		email: valueSchema(type('string.email'), ''),
		password: valueSchema(type('string >= 8'), ''),
		confirmPassword: valueSchema(type('string >= 8'), ''),
	},
	{
		// Cross-field rule: confirm must match password. Path-routed so the
		// issue surfaces on the `confirmPassword` field.
		validate: ({ scope }: { scope: any }) => {
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

export const personalStep = valueScope({
	firstName: valueSchema(type('string >= 1'), ''),
	lastName: valueSchema(type('string >= 1'), ''),
});

export const prefsStep = valueScope({
	theme: valueSchema(type("'light' | 'dark'"), 'light'),
	notifications: value<boolean>(true),
});

// ── Wizard scope ──────────────────────────────────────────────────────
// `valueRef(() => step.create())` is a FACTORY ref: each wizard instance
// gets its own step instances. Passing the template directly to `valueRef()`
// would NOT create instances.

export const wizardScope = valueScope({
	currentStep: value<number>(0),

	account: valueRef(() => accountStep.create()),
	personal: valueRef(() => personalStep.create()),
	prefs: valueRef(() => prefsStep.create()),

	stepCount: 3 as const, // plain readonly data — accessed directly, no `.use()`

	canGoBack: ({ scope }: { scope: any }) => scope.currentStep.use() > 0,
	canGoForward: ({ scope }: { scope: any }) =>
		scope.currentStep.use() < scope.stepCount - 1,
});

export type WizardInstance = ReturnType<typeof wizardScope.create>;
