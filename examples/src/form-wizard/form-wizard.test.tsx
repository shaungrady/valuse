import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { accountStep, personalStep, prefsStep, wizardScope } from './model.js';
import {
	AccountStep,
	PersonalStep,
	SchemaField,
	SubmitButton,
	WizardNav,
} from './components.js';

describe('form-wizard: step scopes', () => {
	it('accountStep schema rejects bad inputs and accepts good ones', () => {
		const acc = accountStep.create();
		expect(acc.email.getValidation().isValid).toBe(false);
		acc.email.set('alice@example.com');
		expect(acc.email.getValidation().isValid).toBe(true);

		acc.password.set('short');
		expect(acc.password.getValidation().isValid).toBe(false);
		acc.password.set('longenough');
		expect(acc.password.getValidation().isValid).toBe(true);
	});

	it("validate routes 'Passwords must match' to confirmPassword", () => {
		const acc = accountStep.create();
		acc.password.set('hunter2hunter2');
		acc.confirmPassword.set('different-pass');

		// Per-field validation: confirm meets its own schema (>= 8 chars).
		// But the scope-level `validate` adds a cross-field issue routed to
		// `confirmPassword.issues` via `path: ['confirmPassword']`.
		const v = acc.confirmPassword.getValidation();
		expect(v.isValid).toBe(false);
		expect(v.issues.some((i) => i.message === 'Passwords must match')).toBe(
			true,
		);

		// Making them match clears the cross-field error.
		acc.confirmPassword.set('hunter2hunter2');
		expect(acc.confirmPassword.getValidation().isValid).toBe(true);
	});

	it('$getIsValid aggregates per-field + validate', () => {
		const acc = accountStep.create();
		expect(acc.$getIsValid()).toBe(false);
		acc.email.set('alice@example.com');
		acc.password.set('hunter2hunter2');
		acc.confirmPassword.set('hunter2hunter2');
		expect(acc.$getIsValid()).toBe(true);
	});

	it('prefsStep: notifications is a plain Value (no schema)', () => {
		const p = prefsStep.create();
		expect(p.notifications.get()).toBe(true);
		p.notifications.set(false);
		expect(p.notifications.get()).toBe(false);
	});

	it('personalStep: schema validation for length bounds', () => {
		const p = personalStep.create();
		expect(p.firstName.getValidation().isValid).toBe(false);
		p.firstName.set('Alice');
		expect(p.firstName.getValidation().isValid).toBe(true);
	});
});

describe('form-wizard: wizard composition', () => {
	it('factory refs give each wizard instance its own step instances', () => {
		const a = wizardScope.create();
		const b = wizardScope.create();

		a.account.email.set('a@example.com');
		expect(b.account.email.get()).toBe('');
	});

	it('stepCount is plain readonly data', () => {
		const w = wizardScope.create();
		expect(w.stepCount).toBe(3);
	});

	it('canGoBack / canGoForward derive from currentStep', () => {
		const w = wizardScope.create();
		expect(w.canGoBack.get()).toBe(false);
		expect(w.canGoForward.get()).toBe(true);

		w.currentStep.set(1);
		expect(w.canGoBack.get()).toBe(true);
		expect(w.canGoForward.get()).toBe(true);

		w.currentStep.set(2);
		expect(w.canGoForward.get()).toBe(false);
	});

	it('$getIsValid({ deep: true }) walks step refs', () => {
		const w = wizardScope.create();
		expect(w.$getIsValid({ deep: true })).toBe(false);

		w.account.email.set('alice@example.com');
		w.account.password.set('hunter2hunter2');
		w.account.confirmPassword.set('hunter2hunter2');
		w.personal.firstName.set('Alice');
		w.personal.lastName.set('Smith');

		expect(w.$getIsValid({ deep: true })).toBe(true);
	});
});

describe('form-wizard: components', () => {
	it('SchemaField renders value, error list, and aria-invalid', () => {
		const acc = accountStep.create();
		render(<SchemaField field={acc.email} label="Email" type="email" />);

		const input = screen.getByLabelText('Email') as HTMLInputElement;
		expect(input.getAttribute('aria-invalid')).toBe('true');
		// Default '' fails the schema, so an error list renders.
		expect(screen.queryByLabelText('Email errors')).not.toBeNull();

		fireEvent.change(input, { target: { value: 'alice@example.com' } });
		expect(input.getAttribute('aria-invalid')).toBe(null);
		expect(screen.queryByLabelText('Email errors')).toBeNull();
	});

	it('AccountStep renders all three fields wired to validation', () => {
		const w = wizardScope.create();
		render(<AccountStep wizard={w} />);

		expect(screen.getByLabelText('Email')).toBeDefined();
		expect(screen.getByLabelText('Password')).toBeDefined();
		expect(screen.getByLabelText('Confirm Password')).toBeDefined();

		fireEvent.change(screen.getByLabelText('Password'), {
			target: { value: 'hunter2hunter2' },
		});
		fireEvent.change(screen.getByLabelText('Confirm Password'), {
			target: { value: 'differentpass' },
		});
		// Cross-field error surfaces on the Confirm Password field.
		const errors = screen.getByLabelText('Confirm Password errors');
		expect(errors.textContent).toContain('Passwords must match');
	});

	it('WizardNav: Back disabled at step 0; Next moves forward', () => {
		const w = wizardScope.create();
		// Sanity: model-level state matches expectations before mounting.
		expect(w.canGoBack.get()).toBe(false);
		expect(w.canGoForward.get()).toBe(true);
		render(<WizardNav wizard={w} />);

		const back = screen.getByRole('button', {
			name: 'Back',
		}) as HTMLButtonElement;
		const next = screen.getByRole('button', {
			name: 'Next',
		}) as HTMLButtonElement;
		expect(back.disabled).toBe(true);
		expect(next.disabled).toBe(false);

		fireEvent.click(next);
		expect(w.currentStep.get()).toBe(1);
		expect(back.disabled).toBe(false);
	});

	it('WizardNav: Next disabled on the last step', () => {
		const w = wizardScope.create();
		act(() => w.currentStep.set(2));
		render(<WizardNav wizard={w} />);
		const next = screen.getByRole('button', {
			name: 'Next',
		}) as HTMLButtonElement;
		expect(next.disabled).toBe(true);
	});

	it('SubmitButton: disabled until all fields valid', () => {
		const w = wizardScope.create();
		let submitted = 0;
		render(<SubmitButton wizard={w} onSubmit={() => submitted++} />);

		const btn = screen.getByRole('button', {
			name: 'Submit',
		}) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);

		// Make all fields valid.
		act(() => {
			w.account.email.set('alice@example.com');
			w.account.password.set('hunter2hunter2');
			w.account.confirmPassword.set('hunter2hunter2');
			w.personal.firstName.set('Alice');
			w.personal.lastName.set('Smith');
		});
		expect(btn.disabled).toBe(false);

		fireEvent.click(btn);
		expect(submitted).toBe(1);
	});

	it('PersonalStep mounts the personal fields', () => {
		const w = wizardScope.create();
		render(<PersonalStep wizard={w} />);
		expect(screen.getByLabelText('First Name')).toBeDefined();
		expect(screen.getByLabelText('Last Name')).toBeDefined();
	});
});
