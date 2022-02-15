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

import { ModelServerCommand, ModelServerObjectV2, Operations, replace } from '@eclipse-emfcloud/modelserver-client';
import {
    CommandProvider,
    Logger,
    MaybePromise,
    ModelServerClientApi,
    ModelServerPlugin,
    ModelServerPluginContext,
    Transaction
} from '@eclipse-emfcloud/modelserver-plugin-ext';
import { inject, injectable, named } from 'inversify';

/**
 * A simple example of a plug-in that provides custom commands.
 */
@injectable()
export class ExampleCustomCommandPlugin implements ModelServerPlugin {
    @inject(Logger)
    @named(ExampleCustomCommandPlugin.name)
    protected readonly logger: Logger;

    @inject(ModelServerClientApi)
    protected modelServerClient: ModelServerClientApi;

    initialize(context: ModelServerPluginContext): MaybePromise<boolean> {
        context.registerCommandProvider('increment-duration', new IncrementDurationCommandProvider(this.modelServerClient, this.logger));
        this.logger.info('Registered example increment-duration command provider.');
        return true;
    }
}

/**
 * A simple example of a custom command provider that provides an implementation of the `'increment-duration'` command.
 * This command increments the `duration` of a workflow `Task` in a compound of two commands, in which the result of
 * the first command is an input to the second.
 */
class IncrementDurationCommandProvider implements CommandProvider {
    constructor(protected readonly modelServerClient: ModelServerClientApi, protected readonly logger: Logger) {}

    canHandle(customCommand: ModelServerCommand): boolean {
        return true; // The command type filter is all I need
    }

    getCommands(customCommand: ModelServerCommand): Transaction {
        const [modelURI, elementID] = customCommand.owner.$ref.split('#');

        return async executor => {
            const element = await this.modelServerClient.getElementById(modelURI, elementID, isTask);

            if (element) {
                this.logger.debug('Got an element: %s.', element);
                const oldDuration = element.duration ?? 0;
                const newDuration = oldDuration + 1;
                this.logger.debug(`Setting duration to ${newDuration}.`);

                const setOp = replace(modelURI, element, 'duration', newDuration);
                const executionResult = (await executor.applyPatch(setOp)).patch;

                if (!executionResult || !executionResult.length) {
                    this.logger.warn('Initial duration increment returned an empty model update result.');
                    return false; // Failed to complete the chain, so roll back
                }

                // Check the old value in the result, add the new value from the previous command to that, then
                // set that into the duration in a second command in this transaction.
                // What pattern do you see emerging?
                const newValue =
                    // Note that we will get an 'add' op if the 'duration' attribute did not previously exist
                    Operations.isAdd(executionResult[0], 'number') || Operations.isReplace(executionResult[0], 'number')
                        ? executionResult[0].value
                        : undefined;
                if (newValue) {
                    const newNewDuration = oldDuration + newValue;
                    const doubleOp = replace(modelURI, element, 'duration', newNewDuration);
                    this.logger.debug(`Updating duration to ${newNewDuration}.`);
                    return executor.applyPatch(doubleOp).then(() => true);
                }
                this.logger.warn('Failed to process result of initial duration increment.');
                return false; // Failed to complete the chain, so roll back
            }

            return false;
        };
    }
}

/**
 * Type guard for objects of `Task` type coming in from JSON.
 *
 * @param o an object to test for task-ness
 * @returns the object as a task, if it is one
 */
function isTask(o: any): o is ModelServerObjectV2 & { duration: number } {
    return '$type' in o && o.$type.endsWith('Task');
}
