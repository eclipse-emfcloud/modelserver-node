/********************************************************************************
 * Copyright (c) 2022 STMicroelectronics.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * https://www.eclipse.org/legal/epl-2.0, or the MIT License which is
 * available at https://opensource.org/licenses/MIT.
 *
 * SPDX-License-Identifier: EPL-2.0 OR MIT
 *******************************************************************************/

/**
 * A simple protocol for a deferred value: an externally settlable promise.
 */
export interface Deferred<T> {
    /** Obtain the deferred value. */
    promise(): Promise<T>;
    /** Resolve the deferred value. */
    resolve(value: T | PromiseLike<T>): void;
    /** Reject the deferred value. */
    reject(reason?: any): void;
}

/**
 * Create a new deferred value.
 *
 * @returns a new deferred value
 */
export function defer<T>(): Deferred<T> {
    return new DeferredImpl<T>();
}

class DeferredImpl<T> implements Deferred<T> {
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;

    private readonly promise_: Promise<T>;

    constructor() {
        this.promise_ = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    promise(): Promise<T> {
        return this.promise_;
    }
}
