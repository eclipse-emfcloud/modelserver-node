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

export type Disposable = () => void;

export namespace Disposable {
    /**
     * Compose a bunch of disposables.
     *
     * @param disposables disposables to dispose
     * @returns a composed disposable
     */
    export function all(...disposables: Disposable[]): Disposable {
        return () => disposables.forEach(dispose);
    }

    /**
     * Dispose an optional disposable, returning a disposable to replace it.
     *
     * For example,
     *
     * ```typescript
     *    let cleanup?: Disposable;
     *
     *    // ...
     *
     *    cleanup = dispose(cleanup);
     * ```
     */
    export function dispose(disposable?: Disposable): Disposable | undefined {
        if (disposable) {
            disposable();
        }
        return undefined;
    }
}
