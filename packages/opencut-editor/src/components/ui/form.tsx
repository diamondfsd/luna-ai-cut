"use client";

import * as React from "react";
import { type Label as LabelPrimitive, Slot as SlotPrimitive } from "radix-ui";

import {
	Controller,
	type ControllerProps,
	type DefaultValues,
	type FieldPath,
	type FieldValues,
	FormProvider,
	useFormContext,
	type UseFormReturn,
} from "react-hook-form";

import { cn } from "@/utils/ui";
import { Label } from "./label";

const DRAFT_DEBOUNCE_MS = 500;

export interface DraftStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

type FormProps<
	TFieldValues extends FieldValues = FieldValues,
	TContext = unknown,
> = UseFormReturn<TFieldValues, TContext> & {
	children: React.ReactNode;
	persistKey?: string;
	storage?: DraftStorage;
};

function Form<
	TFieldValues extends FieldValues = FieldValues,
	TContext = unknown,
>({
	persistKey,
	storage,
	children,
	...methods
}: FormProps<TFieldValues, TContext>) {
	const { watch, reset } = methods;
	// To change keys after mount, re-mount the component with key={persistKey}
	const persistKeyOnMount = React.useRef(persistKey);
	const storageOnMount = React.useRef(storage);
	const resetRef = React.useRef(reset);

	React.useEffect(() => {
		if (!persistKeyOnMount.current) return;
		const store = storageOnMount.current ?? window.localStorage;
		try {
			const stored = store.getItem(persistKeyOnMount.current);
			if (stored) {
				resetRef.current(
					JSON.parse(stored) as DefaultValues<TFieldValues>,
				);
			}
		} catch {
			// Storage may be unavailable (private browsing, storage blocked)
		}
	}, []);

	React.useEffect(() => {
		if (!persistKey) return;
		const store = storageOnMount.current ?? window.localStorage;
		let timer: ReturnType<typeof setTimeout>;
		const subscription = watch((values) => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				try {
					store.setItem(persistKey, JSON.stringify(values));
				} catch {
					// Storage may be full or blocked
				}
			}, DRAFT_DEBOUNCE_MS);
		});
		return () => {
			clearTimeout(timer);
			subscription.unsubscribe();
		};
	}, [persistKey, watch]);

	return <FormProvider {...methods}>{children}</FormProvider>;
}

export function clearFormDraft({
	key,
	storage,
}: {
	key: string;
	storage?: DraftStorage;
}): void {
	const store = storage ?? window.localStorage;
	try {
		store.removeItem(key);
	} catch {
		// Storage may be unavailable
	}
}

type FormFieldContextValue<
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
	name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>(
	{} as FormFieldContextValue,
);

const FormField = <
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
	...props
}: ControllerProps<TFieldValues, TName>) => {
	return (
		<FormFieldContext.Provider value={{ name: props.name }}>
			<Controller {...props} />
		</FormFieldContext.Provider>
	);
};

const useFormField = () => {
	const fieldContext = React.useContext(FormFieldContext);
	const itemContext = React.useContext(FormItemContext);
	const { getFieldState, formState } = useFormContext();

	const fieldState = getFieldState(fieldContext.name, formState);

	if (!fieldContext) {
		throw new Error("useFormField should be used within <FormField>");
	}

	const { id } = itemContext;

	return {
		id,
		name: fieldContext.name,
		formItemId: `${id}-form-item`,
		formDescriptionId: `${id}-form-item-description`,
		formMessageId: `${id}-form-item-message`,
		...fieldState,
	};
};

type FormItemContextValue = {
	id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>(
	{} as FormItemContextValue,
);

const FormItem = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
	const id = React.useId();

	return (
		<FormItemContext.Provider value={{ id }}>
			<div ref={ref} className={cn("space-y-2", className)} {...props} />
		</FormItemContext.Provider>
	);
});
FormItem.displayName = "FormItem";

const FormLabel = React.forwardRef<
	React.ElementRef<typeof LabelPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => {
	const { error, formItemId } = useFormField();

	return (
		<Label
			ref={ref}
			className={cn(error && "text-destructive", className)}
			htmlFor={formItemId}
			{...props}
		/>
	);
});
FormLabel.displayName = "FormLabel";

const FormControl = React.forwardRef<
	React.ElementRef<typeof SlotPrimitive.Slot>,
	React.ComponentPropsWithoutRef<typeof SlotPrimitive.Slot>
>(({ ...props }, ref) => {
	const { error, formItemId, formDescriptionId, formMessageId } =
		useFormField();

	return (
		<SlotPrimitive.Slot
			ref={ref}
			id={formItemId}
			aria-describedby={
				error ? `${formDescriptionId} ${formMessageId}` : `${formDescriptionId}`
			}
			aria-invalid={!!error}
			{...props}
		/>
	);
});
FormControl.displayName = "FormControl";

const FormDescription = React.forwardRef<
	HTMLParagraphElement,
	React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
	const { formDescriptionId } = useFormField();

	return (
		<p
			ref={ref}
			id={formDescriptionId}
			className={cn("text-muted-foreground text-[0.8rem]", className)}
			{...props}
		/>
	);
});
FormDescription.displayName = "FormDescription";

const FormMessage = React.forwardRef<
	HTMLParagraphElement,
	React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
	const { error, formMessageId } = useFormField();
	const body = error ? String(error?.message) : children;

	if (!body) {
		return null;
	}

	return (
		<p
			ref={ref}
			id={formMessageId}
			className={cn("text-destructive text-[0.8rem] font-medium", className)}
			{...props}
		>
			{body}
		</p>
	);
});
FormMessage.displayName = "FormMessage";

export {
	useFormField,
	Form,
	FormItem,
	FormLabel,
	FormControl,
	FormDescription,
	FormMessage,
	FormField,
};
