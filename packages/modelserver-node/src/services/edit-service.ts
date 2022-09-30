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
import { AddCommand, ModelServerCommand, ModelUpdateResult, RemoveCommand, SetCommand } from '@eclipse-emfcloud/modelserver-client';
import { Executor, Logger, Transaction } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { Operation } from 'fast-json-patch';
import { inject, injectable, named } from 'inversify';

import { InternalModelServerClientApi, isModelServerCommand, TransactionContext } from '../client/model-server-client';
import { CommandProviderRegistry } from '../command-provider-registry';
import { ValidationManager } from '../services/validation-manager';
import { TriggerProviderRegistry } from '../trigger-provider-registry';

/**
 * The core implementation of editing via JSON Patch or Command.
 */
@injectable()
export class EditService {
    @inject(Logger)
    @named(EditService.name)
    protected readonly logger: Logger;

    @inject(InternalModelServerClientApi)
    protected readonly modelServerClient: InternalModelServerClientApi;

    @inject(CommandProviderRegistry)
    protected readonly commandProviderRegistry: CommandProviderRegistry;

    @inject(TriggerProviderRegistry)
    protected readonly triggerProviderRegistry: TriggerProviderRegistry;

    @inject(ValidationManager)
    protected readonly validationManager: ValidationManager;

    async edit(modelURI: string, patchOrCommand: Operation | Operation[] | ModelServerCommand): Promise<ModelUpdateResult> {
        if (isModelServerCommand(patchOrCommand)) {
            // Case of executing a command
            const command = patchOrCommand;
            return isCustomCommand(command) ? this.handleCommand(modelURI, command) : this.forwardEdit(modelURI, command);
        }

        // Case of applying a patch
        const patch = patchOrCommand;
        return this.forwardEdit(modelURI, patch);
    }

    protected async handleCommand(modelURI: string, command: ModelServerCommand): Promise<ModelUpdateResult> {
        this.logger.debug(`Getting commands provided for ${command.type}`);

        const provided = await this.commandProviderRegistry.getCommands(modelURI, command);
        return this.forwardEdit(modelURI, provided);
    }

    protected forwardEdit(
        modelURI: string,
        providedEdit: ModelServerCommand | Operation | Operation[] | Transaction
    ): Promise<ModelUpdateResult> {
        if (this.triggerProviderRegistry.hasProviders()) {
            return this.forwardEditWithTriggers(modelURI, providedEdit);
        }
        return this.forwardEditSimple(modelURI, providedEdit);
    }

    private async forwardEditSimple(
        modelURI: string,
        providedEdit: ModelServerCommand | Operation | Operation[] | Transaction
    ): Promise<ModelUpdateResult> {
        if (typeof providedEdit === 'function') {
            // It's a transaction function
            return this.modelServerClient.openTransaction(modelURI).then(ctx =>
                providedEdit(ctx)
                    .then(completeTransaction(ctx))
                    .then(this.performPatchValidation(modelURI))
                    .catch(error => ctx.rollback(error))
            );
        } else {
            // It's a substitute command or JSON Patch. Just execute/apply it in the usual way
            let result: Promise<ModelUpdateResult>;

            if (isModelServerCommand(providedEdit)) {
                // Command case
                result = this.modelServerClient.edit(modelURI, providedEdit);
            } else {
                // JSON Patch case
                result = this.modelServerClient.edit(modelURI, providedEdit);
            }

            return result.then(this.performPatchValidation(modelURI));
        }
    }

    private async forwardEditWithTriggers(
        modelURI: string,
        providedEdit: ModelServerCommand | Operation | Operation[] | Transaction
    ): Promise<ModelUpdateResult> {
        let result = true;

        // Perform the edit in a transaction, then gather triggers, and recurse
        const triggeringTransaction = async (executor: Executor): Promise<boolean> => {
            if (typeof providedEdit === 'function') {
                // It's a transaction function
                result = await providedEdit(executor);
            } else {
                // It's a command or JSON Patch. Just execute/apply it in the usual way
                if (isModelServerCommand(providedEdit)) {
                    // Command case
                    await executor.execute(modelURI, providedEdit);
                } else {
                    // JSON Patch case
                    await executor.applyPatch(providedEdit);
                }
            }

            return result;
        };

        return this.modelServerClient.openTransaction(modelURI).then(ctx =>
            triggeringTransaction(ctx)
                .then(completeTransaction(ctx)) // The transaction context performs the triggers
                .then(this.performPatchValidation(modelURI))
                .catch(error => ctx.rollback(error))
        );
    }

    /**
     * Follow up patch of a model with validation of the same.
     *
     * @param modelURI the model patched
     * @returns a function that performs live validation on a model update result if it was successful
     */
    protected performPatchValidation(modelURI: string): (validate: ModelUpdateResult) => Promise<ModelUpdateResult> {
        const validator = this.validationManager;

        return async (validate: ModelUpdateResult) => {
            if (validate.success) {
                return validator.performLiveValidation(modelURI).then(() => validate);
            }
            this.logger.debug('Not validating the failed command/patch.');
            return validate;
        };
    }
}

function isCustomCommand(command: ModelServerCommand): boolean {
    return !(SetCommand.is(command) || AddCommand.is(command) || RemoveCommand.is(command));
}

/**
 * Complete a `transaction`.
 *
 * @param transaction the transaction context to complete
 * @returns a function that takes a downstream response and returns a model update result, possibly rejected
 */
function completeTransaction(transaction: TransactionContext): (downstream: boolean) => Promise<ModelUpdateResult> {
    return async downstream => {
        if (!downstream) {
            const reason = 'Transaction failed';
            return transaction.rollback(reason);
        } else {
            return transaction.commit();
        }
    };
}
