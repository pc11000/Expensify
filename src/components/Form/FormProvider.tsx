import lodashIsEqual from 'lodash/isEqual';
import type {ForwardedRef, MutableRefObject, ReactNode} from 'react';
import React, {createRef, forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState} from 'react';
import type {OnyxEntry} from 'react-native-onyx';
import {withOnyx} from 'react-native-onyx';
import * as ValidationUtils from '@libs/ValidationUtils';
import Visibility from '@libs/Visibility';
import * as FormActions from '@userActions/FormActions';
import CONST from '@src/CONST';
import type {OnyxFormKey} from '@src/ONYXKEYS';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Form, Network} from '@src/types/onyx';
import type {FormValueType} from '@src/types/onyx/Form';
import type {Errors} from '@src/types/onyx/OnyxCommon';
import {isEmptyObject} from '@src/types/utils/EmptyObject';
import FormContext from './FormContext';
import FormWrapper from './FormWrapper';
import type {BaseInputProps, FormProps, InputRefs, OnyxFormKeyWithoutDraft, OnyxFormValues, OnyxFormValuesFields, RegisterInput, ValueTypeKey} from './types';

// In order to prevent Checkbox focus loss when the user are focusing a TextInput and proceeds to toggle a CheckBox in web and mobile web.
// 200ms delay was chosen as a result of empirical testing.
// More details: https://github.com/Expensify/App/pull/16444#issuecomment-1482983426
const VALIDATE_DELAY = 200;

type InitialDefaultValue = false | Date | '';

function getInitialValueByType(valueType?: ValueTypeKey): InitialDefaultValue {
    switch (valueType) {
        case 'string':
            return '';
        case 'boolean':
            return false;
        case 'date':
            return new Date();
        default:
            return '';
    }
}

type FormProviderOnyxProps = {
    /** Contains the form state that must be accessed outside the component */
    formState: OnyxEntry<Form>;

    /** Contains draft values for each input in the form */
    draftValues: OnyxEntry<Form>;

    /** Information about the network */
    network: OnyxEntry<Network>;
};

type FormProviderProps<TFormID extends OnyxFormKey = OnyxFormKey> = FormProviderOnyxProps &
    FormProps<TFormID> & {
        /** Children to render. */
        children: ((props: {inputValues: OnyxFormValues<TFormID>}) => ReactNode) | ReactNode;

        /** Callback to validate the form */
        validate?: (values: OnyxFormValuesFields<TFormID>) => Errors;

        /** Should validate function be called when input loose focus */
        shouldValidateOnBlur?: boolean;

        /** Should validate function be called when the value of the input is changed */
        shouldValidateOnChange?: boolean;
    };

type FormRef<TFormID extends OnyxFormKey = OnyxFormKey> = {
    resetForm: (optionalValue: OnyxFormValues<TFormID>) => void;
};

function FormProvider(
    {
        formID,
        validate,
        shouldValidateOnBlur = true,
        shouldValidateOnChange = true,
        children,
        formState,
        network,
        enabledWhenOffline = false,
        draftValues,
        onSubmit,
        ...rest
    }: FormProviderProps,
    forwardedRef: ForwardedRef<FormRef>,
) {
    const inputRefs = useRef<InputRefs>({});
    const touchedInputs = useRef<Record<string, boolean>>({});
    const [inputValues, setInputValues] = useState<Form>(() => ({...draftValues}));
    const [errors, setErrors] = useState<Errors>({});
    const hasServerError = useMemo(() => !!formState && !isEmptyObject(formState?.errors), [formState]);

    const onValidate = useCallback(
        (values: OnyxFormValuesFields, shouldClearServerError = true) => {
            const trimmedStringValues = ValidationUtils.prepareValues(values);

            if (shouldClearServerError) {
                FormActions.clearErrors(formID);
            }
            FormActions.clearErrorFields(formID);

            const validateErrors = validate?.(trimmedStringValues) ?? {};

            // Validate the input for html tags. It should supersede any other error
            Object.entries(trimmedStringValues).forEach(([inputID, inputValue]) => {
                // If the input value is empty OR is non-string, we don't need to validate it for HTML tags
                if (!inputValue || typeof inputValue !== 'string') {
                    return;
                }
                const foundHtmlTagIndex = inputValue.search(CONST.VALIDATE_FOR_HTML_TAG_REGEX);
                const leadingSpaceIndex = inputValue.search(CONST.VALIDATE_FOR_LEADINGSPACES_HTML_TAG_REGEX);

                // Return early if there are no HTML characters
                if (leadingSpaceIndex === -1 && foundHtmlTagIndex === -1) {
                    return;
                }

                const matchedHtmlTags = inputValue.match(CONST.VALIDATE_FOR_HTML_TAG_REGEX);
                let isMatch = CONST.WHITELISTED_TAGS.some((regex) => regex.test(inputValue));
                // Check for any matches that the original regex (foundHtmlTagIndex) matched
                if (matchedHtmlTags) {
                    // Check if any matched inputs does not match in WHITELISTED_TAGS list and return early if needed.
                    for (const htmlTag of matchedHtmlTags) {
                        isMatch = CONST.WHITELISTED_TAGS.some((regex) => regex.test(htmlTag));
                        if (!isMatch) {
                            break;
                        }
                    }
                }

                if (isMatch && leadingSpaceIndex === -1) {
                    return;
                }

                // Add a validation error here because it is a string value that contains HTML characters
                validateErrors[inputID] = 'common.error.invalidCharacter';
            });

            if (typeof validateErrors !== 'object') {
                throw new Error('Validate callback must return an empty object or an object with shape {inputID: error}');
            }

            const touchedInputErrors = Object.fromEntries(Object.entries(validateErrors).filter(([inputID]) => touchedInputs.current[inputID]));

            if (!lodashIsEqual(errors, touchedInputErrors)) {
                setErrors(touchedInputErrors);
            }

            return touchedInputErrors;
        },
        [errors, formID, validate],
    );

    /** @param inputID - The inputID of the input being touched */
    const setTouchedInput = useCallback(
        (inputID: keyof Form) => {
            touchedInputs.current[inputID] = true;
        },
        [touchedInputs],
    );

    const submit = useCallback(() => {
        // Return early if the form is already submitting to avoid duplicate submission
        if (formState?.isLoading) {
            return;
        }

        // Prepare values before submitting
        const trimmedStringValues = ValidationUtils.prepareValues(inputValues);

        // Touches all form inputs, so we can validate the entire form
        Object.keys(inputRefs.current).forEach((inputID) => (touchedInputs.current[inputID] = true));

        // Validate form and return early if any errors are found
        if (!isEmptyObject(onValidate(trimmedStringValues))) {
            return;
        }

        // Do not submit form if network is offline and the form is not enabled when offline
        if (network?.isOffline && !enabledWhenOffline) {
            return;
        }

        onSubmit(trimmedStringValues);
    }, [enabledWhenOffline, formState?.isLoading, inputValues, network?.isOffline, onSubmit, onValidate]);

    const resetForm = useCallback(
        (optionalValue: OnyxFormValuesFields) => {
            Object.keys(inputValues).forEach((inputID) => {
                setInputValues((prevState) => {
                    const copyPrevState = {...prevState};

                    touchedInputs.current[inputID] = false;
                    copyPrevState[inputID] = optionalValue[inputID as keyof OnyxFormValuesFields] || '';

                    return copyPrevState;
                });
            });
            setErrors({});
        },
        [inputValues],
    );
    useImperativeHandle(forwardedRef, () => ({
        resetForm,
    }));

    const registerInput = useCallback<RegisterInput>(
        <TInputProps extends BaseInputProps>(inputID: keyof Form, inputProps: TInputProps): TInputProps => {
            const newRef: MutableRefObject<BaseInputProps> = inputRefs.current[inputID] ?? inputProps.ref ?? createRef();
            if (inputRefs.current[inputID] !== newRef) {
                inputRefs.current[inputID] = newRef;
            }
            if (inputProps.value !== undefined) {
                inputValues[inputID] = inputProps.value;
            } else if (inputProps.shouldSaveDraft && draftValues?.[inputID] !== undefined && inputValues[inputID] === undefined) {
                inputValues[inputID] = draftValues[inputID];
            } else if (inputProps.shouldUseDefaultValue && inputProps.defaultValue !== undefined && inputValues[inputID] === undefined) {
                // We force the form to set the input value from the defaultValue props if there is a saved valid value
                inputValues[inputID] = inputProps.defaultValue;
            } else if (inputValues[inputID] === undefined) {
                // We want to initialize the input value if it's undefined
                inputValues[inputID] = inputProps.defaultValue ?? getInitialValueByType(inputProps.valueType);
            }

            const errorFields = formState?.errorFields?.[inputID] ?? {};
            const fieldErrorMessage =
                Object.keys(errorFields)
                    .sort()
                    .map((key) => errorFields[key])
                    .at(-1) ?? '';

            const inputRef = inputProps.ref;

            return {
                ...inputProps,
                ref:
                    typeof inputRef === 'function'
                        ? (node: BaseInputProps) => {
                              inputRef(node);
                              newRef.current = node;
                          }
                        : newRef,
                inputID,
                key: inputProps.key ?? inputID,
                errorText: errors[inputID] ?? fieldErrorMessage,
                value: inputValues[inputID],
                // As the text input is controlled, we never set the defaultValue prop
                // as this is already happening by the value prop.
                defaultValue: undefined,
                onTouched: (event) => {
                    if (!inputProps.shouldSetTouchedOnBlurOnly) {
                        setTimeout(() => {
                            setTouchedInput(inputID);
                        }, VALIDATE_DELAY);
                    }
                    inputProps.onTouched?.(event);
                },
                onPress: (event) => {
                    if (!inputProps.shouldSetTouchedOnBlurOnly) {
                        setTimeout(() => {
                            setTouchedInput(inputID);
                        }, VALIDATE_DELAY);
                    }
                    inputProps.onPress?.(event);
                },
                onPressOut: (event) => {
                    // To prevent validating just pressed inputs, we need to set the touched input right after
                    // onValidate and to do so, we need to delay setTouchedInput of the same amount of time
                    // as the onValidate is delayed
                    if (!inputProps.shouldSetTouchedOnBlurOnly) {
                        setTimeout(() => {
                            setTouchedInput(inputID);
                        }, VALIDATE_DELAY);
                    }
                    inputProps.onPressOut?.(event);
                },
                onBlur: (event) => {
                    // Only run validation when user proactively blurs the input.
                    if (Visibility.isVisible() && Visibility.hasFocus()) {
                        const relatedTarget = event && 'relatedTarget' in event.nativeEvent && event?.nativeEvent?.relatedTarget;
                        const relatedTargetId = relatedTarget && 'id' in relatedTarget && typeof relatedTarget.id === 'string' && relatedTarget.id;
                        // We delay the validation in order to prevent Checkbox loss of focus when
                        // the user is focusing a TextInput and proceeds to toggle a CheckBox in
                        // web and mobile web platforms.

                        setTimeout(() => {
                            if (
                                relatedTargetId === CONST.OVERLAY.BOTTOM_BUTTON_NATIVE_ID ||
                                relatedTargetId === CONST.OVERLAY.TOP_BUTTON_NATIVE_ID ||
                                relatedTargetId === CONST.BACK_BUTTON_NATIVE_ID
                            ) {
                                return;
                            }
                            setTouchedInput(inputID);
                            if (shouldValidateOnBlur) {
                                onValidate(inputValues, !hasServerError);
                            }
                        }, VALIDATE_DELAY);
                    }
                    inputProps.onBlur?.(event);
                },
                onInputChange: (value: FormValueType, key?: string) => {
                    const inputKey = key ?? inputID;
                    setInputValues((prevState) => {
                        const newState = {
                            ...prevState,
                            [inputKey]: value,
                        };

                        if (shouldValidateOnChange) {
                            onValidate(newState);
                        }
                        return newState as Form;
                    });

                    if (inputProps.shouldSaveDraft && !formID.includes('Draft')) {
                        FormActions.setDraftValues(formID as OnyxFormKeyWithoutDraft, {[inputKey]: value});
                    }
                    inputProps.onValueChange?.(value, inputKey);
                },
            };
        },
        [draftValues, formID, errors, formState, hasServerError, inputValues, onValidate, setTouchedInput, shouldValidateOnBlur, shouldValidateOnChange],
    );
    const value = useMemo(() => ({registerInput}), [registerInput]);

    return (
        <FormContext.Provider value={value}>
            {/* eslint-disable react/jsx-props-no-spreading */}
            <FormWrapper
                {...rest}
                formID={formID}
                onSubmit={submit}
                inputRefs={inputRefs}
                errors={errors}
                enabledWhenOffline={enabledWhenOffline}
            >
                {typeof children === 'function' ? children({inputValues}) : children}
            </FormWrapper>
        </FormContext.Provider>
    );
}

FormProvider.displayName = 'Form';

export default withOnyx<FormProviderProps, FormProviderOnyxProps>({
    network: {
        key: ONYXKEYS.NETWORK,
    },
    // withOnyx typings are not able to handle such generic cases like this one, since it's a generic component we need to cast the keys to any
    formState: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        key: ({formID}) => formID as any,
    },
    draftValues: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        key: (props) => `${props.formID}Draft` as any,
    },
})(forwardRef(FormProvider)) as <TFormID extends OnyxFormKey>(props: Omit<FormProviderProps<TFormID>, keyof FormProviderOnyxProps>) => ReactNode;
