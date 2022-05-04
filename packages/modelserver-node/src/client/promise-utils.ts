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
export interface CompletablePromise<T> extends PromiseLike<T> {
    /** Complete the promise by resolving its value. */
    resolve(value: T | PromiseLike<T>): void;
    /** Settle the promise by rejecting its value. */
    reject(reason?: any): void;

    /** Handle the rejection case only, as with a `Promise`. */
    catch<U = never>(onrejected?: ((reason: any) => U | PromiseLike<U>) | undefined | null): Promise<T | U>;
}

export namespace CompletablePromise {
    /**
     * Create a new completable promise.
     *
     * @returns a new completable promise
     */
    export function newPromise<T>(): CompletablePromise<T> {
        return new Impl<T>();
    }

    class Impl<T> implements CompletablePromise<T> {
        resolve: (value: T | PromiseLike<T>) => void;
        reject: (reason?: any) => void;

        private readonly promise: Promise<T>;

        constructor() {
            this.promise = new Promise((resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;
            });
        }

        then<U = T, V = never>(
            onfulfilled?: (value: T) => U | PromiseLike<U>,
            onrejected?: (reason: any) => V | PromiseLike<V>
        ): PromiseLike<U | V> {
            return this.promise.then(onfulfilled, onrejected);
        }

        catch<U = never>(onrejected?: (reason: any) => U | PromiseLike<U>): Promise<T | U> {
            return this.promise.catch(onrejected);
        }
    }
}
