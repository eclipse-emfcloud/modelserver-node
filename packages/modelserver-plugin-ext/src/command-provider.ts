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

import { ModelServerCommand } from '@eclipse-emfcloud/modelserver-client';

import { Transaction } from './executor';
import { MaybePromise } from './util';

/**
 * Protocol for a provider of custom commands that may be registered by a _Model Server_ plug-in.
 */
export interface CommandProvider {
    /**
     * Query whether the provider handles the given custom command.
     * Only a provider registered against the command's type will be queried, so filtering on
     * the type in this method would be redundant.
     * If the provider returns `true` then it _must_ handle the command.
     * Otherwise, it will not be invoked to handle the command.
     *
     * @param customCommand the custom command to be translated
     * @returns whether the provider can handle the given command
     */
    canHandle(customCommand: ModelServerCommand): boolean;

    /**
     * Obtain a translation of the given custom command to primitive commands (one or a composite of many)
     * that the _Upstream Model Server_ understands natively.
     *
     * @param modelUri the URI of the model being edited.
     * @param customCommand the custom command to translate to _Upstream Model Server_ primitives
     * @returns either a command to substitute for the custom command (perhaps a compound command) or a
     *     transaction that should be run in the context of a transactional compound command {@link Executor}
     */
    getCommands(modelUri: string, customCommand: ModelServerCommand): MaybePromise<ModelServerCommand | Transaction>;
}
