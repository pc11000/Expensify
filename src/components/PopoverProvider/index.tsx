import type {RefObject} from 'react';
import React, {createContext, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {View} from 'react-native';
import type {AnchorRef, PopoverContextProps, PopoverContextValue} from './types';

const PopoverContext = createContext<PopoverContextValue>({
    onOpen: () => {},
    popover: {},
    close: () => {},
    isOpen: false,
});

function elementContains(ref: RefObject<View | HTMLElement> | undefined, target: EventTarget | null) {
    if (ref?.current && 'contains' in ref?.current && ref?.current?.contains(target as Node)) {
        return true;
    }
    return false;
}

function PopoverContextProvider(props: PopoverContextProps) {
    const [isOpen, setIsOpen] = useState(false);
    const activePopoverRef = useRef<AnchorRef | null>(null);

    const closePopover = useCallback((anchorRef?: RefObject<View | HTMLElement>) => {
        if (!activePopoverRef.current || (anchorRef && anchorRef !== activePopoverRef.current.anchorRef)) {
            return;
        }

        activePopoverRef.current.close();
        if (activePopoverRef.current.onCloseCallback) {
            activePopoverRef.current.onCloseCallback();
        }
        activePopoverRef.current = null;
        setIsOpen(false);
    }, []);

    useEffect(() => {
        const listener = (e: Event) => {
            if (elementContains(activePopoverRef.current?.ref, e.target) || elementContains(activePopoverRef.current?.anchorRef, e.target)) {
                return;
            }
            const ref = activePopoverRef.current?.anchorRef;
            closePopover(ref);
        };
        document.addEventListener('click', listener, true);
        return () => {
            document.removeEventListener('click', listener, true);
        };
    }, [closePopover]);

    useEffect(() => {
        const listener = (e: Event) => {
            if (elementContains(activePopoverRef.current?.ref, e.target)) {
                return;
            }
            closePopover();
        };
        document.addEventListener('contextmenu', listener);
        return () => {
            document.removeEventListener('contextmenu', listener);
        };
    }, [closePopover]);

    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') {
                return;
            }
            closePopover();
        };
        document.addEventListener('keydown', listener, true);
        return () => {
            document.removeEventListener('keydown', listener, true);
        };
    }, [closePopover]);

    useEffect(() => {
        const listener = () => {
            if (document.hasFocus()) {
                return;
            }
            closePopover();
        };
        document.addEventListener('visibilitychange', listener);
        return () => {
            document.removeEventListener('visibilitychange', listener);
        };
    }, [closePopover]);

    useEffect(() => {
        const listener = (e: Event) => {
            if (elementContains(activePopoverRef.current?.ref, e.target)) {
                return;
            }

            closePopover();
        };
        document.addEventListener('wheel', listener, true);
        return () => {
            document.removeEventListener('wheel', listener, true);
        };
    }, [closePopover]);

    const onOpen = useCallback(
        (popoverParams: AnchorRef) => {
            if (activePopoverRef.current && activePopoverRef.current.ref !== popoverParams?.ref) {
                closePopover(activePopoverRef.current.anchorRef);
            }
            activePopoverRef.current = popoverParams;
            if (popoverParams?.onOpenCallback) {
                popoverParams.onOpenCallback();
            }
            setIsOpen(true);
        },
        [closePopover],
    );

    const contextValue = useMemo(
        () => ({
            onOpen,
            close: closePopover,
            popover: activePopoverRef.current,
            isOpen,
        }),
        [onOpen, closePopover, isOpen],
    );

    return <PopoverContext.Provider value={contextValue}>{props.children}</PopoverContext.Provider>;
}

PopoverContextProvider.displayName = 'PopoverContextProvider';

export default PopoverContextProvider;

export {PopoverContext};
