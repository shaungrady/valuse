import type { FieldValueSchema } from 'valuse';
import 'valuse/react';
import type { WizardInstance } from './model.js';

// Reusable schema-aware text field. Reads value + setter + validation in one
// call via `useValidation()`. The first two slots match `.use()` exactly so
// the destructure swaps cleanly.
export function SchemaField({
	field,
	label,
	type = 'text',
}: {
	field: FieldValueSchema<string, string>;
	label: string;
	type?: string;
}) {
	const [val, setVal, validation] = field.useValidation();
	const labelId = `field-${label.replace(/\s+/g, '-').toLowerCase()}`;

	return (
		<div>
			<label htmlFor={labelId}>{label}</label>
			<input
				id={labelId}
				type={type}
				value={val}
				onChange={(e) => setVal(e.target.value)}
				aria-invalid={!validation.isValid || undefined}
			/>
			{!validation.isValid && (
				<ul aria-label={`${label} errors`}>
					{validation.issues.map((issue, i) => (
						<li key={i}>{issue.message}</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function AccountStep({ wizard }: { wizard: WizardInstance }) {
	const { account } = wizard;
	return (
		<section aria-label="Account">
			<h2>Account</h2>
			<SchemaField field={account.email} label="Email" type="email" />
			<SchemaField field={account.password} label="Password" type="password" />
			<SchemaField
				field={account.confirmPassword}
				label="Confirm Password"
				type="password"
			/>
		</section>
	);
}

export function PersonalStep({ wizard }: { wizard: WizardInstance }) {
	const { personal } = wizard;
	return (
		<section aria-label="Personal">
			<h2>Personal</h2>
			<SchemaField field={personal.firstName} label="First Name" />
			<SchemaField field={personal.lastName} label="Last Name" />
		</section>
	);
}

export function WizardNav({ wizard }: { wizard: WizardInstance }) {
	const [canGoBack] = wizard.canGoBack.use();
	const [canGoForward] = wizard.canGoForward.use();
	const [currentStep, setStep] = wizard.currentStep.use();

	return (
		<nav aria-label="Wizard navigation">
			<button
				type="button"
				disabled={!canGoBack}
				onClick={() => setStep((s) => s - 1)}
			>
				Back
			</button>
			<span>
				Step {currentStep + 1} of {wizard.stepCount}
			</span>
			<button
				type="button"
				disabled={!canGoForward}
				onClick={() => setStep((s) => s + 1)}
			>
				Next
			</button>
		</nav>
	);
}

export function SubmitButton({
	wizard,
	onSubmit,
}: {
	wizard: WizardInstance;
	onSubmit: () => void;
}) {
	// `$useIsValid` re-renders the button only when the overall validity flips.
	// `{ deep: true }` walks all step refs.
	const isValid = wizard.$useIsValid({ deep: true });

	return (
		<button
			type="submit"
			aria-disabled={!isValid}
			disabled={!isValid}
			onClick={onSubmit}
		>
			Submit
		</button>
	);
}
