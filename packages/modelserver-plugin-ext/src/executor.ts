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

import { ModelServerCommand, ModelUpdateResult } from '@eclipse-emfcloud/modelserver-client';
import { Operation } from 'fast-json-patch';

/**
 * Protocol of a context in which commands may be executed and JSON patches applied.
 * This context is transactional: commands/patches are executed/applied on the target model and results returned
 * privately to the client; results are not broadcast to subscribers and the commands are not
 * put onto the undo stack until the context is closed.
 * All commands/patches executed/applied in this context are composed into a compound on the stack for atomic undo/redo.
 */
export interface Executor {
    /**
     * Execute a command on the model.
     *
     * @param command a command to be executed on the model
     * @return the result of the command's execution
     */
    execute(command: ModelServerCommand): Promise<ModelUpdateResult>;

    /**
     * Apply a JSON patch to the model.
     *
     * @param patch the JSON patch to apply
     * @returns a patch describing the changes applied to the model. This may contain more information than
     *   the original `patch` as the server may have additional side-effects
     */
    applyPatch(patch: Operation | Operation[]): Promise<ModelUpdateResult>;
}

/**
 * A function type defining a transaction that executes a sequence of commands/patches,
 * with intermediate and possibly chained results, in the context of a transactional
 * command {@link Executor}.
 */
export type Transaction = (executor: Executor) => Promise<boolean>;
