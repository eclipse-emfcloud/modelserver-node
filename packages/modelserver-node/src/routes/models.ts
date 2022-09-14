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
import {
    AddCommand,
    AnyObject,
    CompoundCommand,
    encode,
    ModelServerCommand,
    ModelUpdateResult,
    RemoveCommand,
    SetCommand
} from '@eclipse-emfcloud/modelserver-client';
import { Executor, Logger, RouteProvider, RouterFactory, Transaction } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { Request, RequestHandler, Response } from 'express';
import { Operation } from 'fast-json-patch';
import { ServerResponse } from 'http';
import { inject, injectable, named } from 'inversify';

import { ExecuteMessageBody, InternalModelServerClientApi, isModelServerCommand, TransactionContext } from '../client/model-server-client';
import { CommandProviderRegistry } from '../command-provider-registry';
import { ValidationManager } from '../services/validation-manager';
import { TriggerProviderRegistry } from '../trigger-provider-registry';
import { handleError, relay, respondError, validateFormat } from './routes';

/**
 * Query parameters for the `POST` or `PUT` request on the `models` endpoint.
 */
interface ModelsPostPutQuery {
    /** The model URI to create or update. */
    modeluri: string;
    format?: string;
}

/**
 * Query parameters for the `PATCH` request on the `models` endpoint.
 */
interface ModelsPatchQuery {
    /** The model URI to patch. */
    modeluri: string;
}

/**
 * Custom routing of requests on the `/api/v2/models` endpoint.
 * The primary such customization is an intercept of the `GET` requests for undo/redo
 * to integrate custom validation providers in live validation.
 */
@injectable()
export class ModelsRoutes implements RouteProvider {
    @inject(Logger)
    @named(ModelsRoutes.name)
    protected readonly logger: Logger;

    @inject(InternalModelServerClientApi)
    protected readonly modelServerClient: InternalModelServerClientApi;

    @inject(CommandProviderRegistry)
    protected readonly commandProviderRegistry: CommandProviderRegistry;

    @inject(TriggerProviderRegistry)
    protected readonly triggerProviderRegistry: TriggerProviderRegistry;

    @inject(ValidationManager)
    protected readonly validationManager: ValidationManager;

    configureRoutes(routerFactory: RouterFactory): void {
        const router = routerFactory('/api/v2/models');
        router.post('/', this.interceptModelsPostPut().bind(this));
        router.put('/', this.interceptModelsPostPut().bind(this));
        router.patch('/', this.interceptModelsPatch().bind(this));
    }

    /**
     * Create a `POST` request handler for the `/api/v2/models` endpoint to intercept perform live validation
     * with custom validation providers after delegation of the base post behaviour to the _Upstream Model Server_.
     *
     * @returns the models intercept handler
     */
    protected interceptModelsPostPut(): RequestHandler<unknown, any, any, ModelsPostPutQuery, Record<string, any>> {
        return async (
            req: Request<unknown, any, any, ModelsPostPutQuery, Record<string, any>>,
            res: Response<any, Record<string, any>>
        ) => {
            const modelURI = req.query.modeluri?.trim();
            if (!modelURI || modelURI === '') {
                handleError(res)('Model URI parameter is absent or empty.');
                return;
            }
            const format = validateFormat(req.query.format);

            const model = asModel(req.body?.data);
            if (!model) {
                handleError(res)('Request body is not a model.');
                return;
            }

            const isCreate = req.method.toUpperCase() === 'POST';
            this.logger.debug(`Delegating ${isCreate ? 'creation' : 'update'} of ${modelURI}.`);
            const delegated = isCreate //
                ? this.modelServerClient.create(modelURI, model, format)
                : this.modelServerClient.update(modelURI, model, format);

            delegated.then(this.performModelValidation(modelURI)).then(relay(res)).catch(handleError(res));
        };
    }

    /**
     * Create a `PATCH` request handler for the `/api/v2/models` endpoint to intercept custom commands, reach out
     * to registered providers to collect delegate commands, and send those along to the _Upstream Model Server_ to complete
     * the edit request.
     *
     * @returns the edit-command intercept handler
     */
    protected interceptModelsPatch(): RequestHandler<unknown, any, any, ModelsPatchQuery, Record<string, any>> {
        return async (req: Request<unknown, any, any, ModelsPatchQuery, Record<string, any>>, res: Response<any, Record<string, any>>) => {
            const modelURI = req.query.modeluri?.trim();
            if (!modelURI || modelURI === '') {
                handleError(res)('Model URI parameter is absent or empty.');
                return;
            }

            const message = req.body?.data;
            if (message && ExecuteMessageBody.isPatch(message)) {
                return this.forwardEdit(modelURI, message.data, res);
            }

            const command = asModelServerCommand(message?.data);
            if (!command) {
                handleError(res)('Request body is not a ModelServerCommand.');
                return;
            }

            return isCustomCommand(command) ? this.handleCommand(modelURI, command, res) : this.forwardEdit(modelURI, command, res);
        };
    }

    protected async handleCommand(modelURI: string, command: ModelServerCommand, res: Response<any, Record<string, any>>): Promise<void> {
        this.logger.debug(`Getting commands provided for ${command.type}`);

        const provided = await this.commandProviderRegistry.getCommands(modelURI, command);
        this.forwardEdit(modelURI, provided, res);
    }

    protected forwardEdit(
        modelURI: string,
        providedEdit: ModelServerCommand | Operation | Operation[] | Transaction,
        res: Response<any, Record<string, any>>
    ): void {
        if (this.triggerProviderRegistry.hasProviders()) {
            return this.forwardEditWithTriggers(modelURI, providedEdit, res);
        }
        return this.forwardEditSimple(modelURI, providedEdit, res);
    }

    private forwardEditSimple(
        modelURI: string,
        providedEdit: ModelServerCommand | Operation | Operation[] | Transaction,
        res: Response<any, Record<string, any>>
    ): void {
        if (typeof providedEdit === 'function') {
            // It's a transaction function
            this.modelServerClient
                .openTransaction(modelURI)
                .then(ctx =>
                    providedEdit(ctx)
                        .then(completeTransaction(ctx, res))
                        .then(this.performPatchValidation(modelURI))
                        .catch(error => ctx.rollback(error).finally(() => respondError(res, error)))
                )
                .catch(handleError(res));
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

            result.then(this.performPatchValidation(modelURI)).then(relay(res)).catch(handleError(res));
        }
    }

    private forwardEditWithTriggers(
        modelURI: string,
        providedEdit: ModelServerCommand | Operation | Operation[] | Transaction,
        res: Response<any, Record<string, any>>
    ): void {
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

        this.modelServerClient
            .openTransaction(modelURI)
            .then(ctx =>
                triggeringTransaction(ctx)
                    .then(completeTransaction(ctx, res)) // The transaction context performs the triggers
                    .then(this.performPatchValidation(modelURI))
                    .catch(error => ctx.rollback(error).finally(() => respondError(res, error)))
            )
            .catch(handleError(res));
    }

    /**
     * Follow up creation or replacement of a model with validation of the same.
     *
     * @param modelURI the model created or replaced
     * @returns the created or replacing model
     */
    protected performModelValidation(modelURI: string): (delegatedResult: AnyObject) => Promise<AnyObject> {
        const validator = this.validationManager;

        return async (delegatedResult: AnyObject) => validator.performLiveValidation(modelURI).then(() => delegatedResult);
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

function asModel(object: any): AnyObject | string | undefined {
    if (typeof object === 'string') {
        return object;
    }
    if (AnyObject.is(object)) {
        return object;
    }

    return undefined;
}

/**
 * Ensure that a command parsed from incoming JSON is a proper instance of the
 * {@link ModelServerCommand} or {@link CompoundCommand} class.
 * This ensures that, for example, methods of the `ModelServerCommand` class
 * are available on the command object.
 *
 * @param command a command
 * @returns the command as a proper instance of the {@link ModelServerCommand} class
 *   or a subclass
 */
function asModelServerCommand(command: any): ModelServerCommand | undefined {
    if (command) {
        // The client uses json-v2 format exclusively for commands/patches
        command = encode('json')(command);
    }

    if (!(command instanceof ModelServerCommand) && isModelServerCommand(command)) {
        let proto: typeof ModelServerCommand.prototype;

        switch (command.eClass) {
            case AddCommand.URI:
                proto = AddCommand.prototype;
                break;
            case RemoveCommand.URI:
                proto = RemoveCommand.prototype;
                break;
            case SetCommand.URI:
                proto = SetCommand.prototype;
                break;
            case CompoundCommand.URI:
                proto = CompoundCommand.prototype;
                break;
            default:
                proto = ModelServerCommand.prototype;
                break;
        }

        Object.setPrototypeOf(command, proto);
        return command as ModelServerCommand;
    }

    return undefined;
}

function isCustomCommand(command: ModelServerCommand): boolean {
    return !(SetCommand.is(command) || AddCommand.is(command) || RemoveCommand.is(command));
}

/**
 * Complete a `transaction` and send a success or error response back to the upstream client according to whether
 * the downstream transaction completed successfully or not.
 *
 * @param transaction the transaction context to complete
 * @param upstream the upstream response stream to which to send the result of transaction completion
 * @returns a function that takes a downstream response and sends an error response if it is not a success response,
 *    otherwise a success response
 */
function completeTransaction(
    transaction: TransactionContext,
    upstream: Response<any, Record<string, any>>
): (downstream: boolean) => Promise<ModelUpdateResult> {
    return async downstream => {
        if (!downstream) {
            const reason = 'Transaction failed';
            return transaction.rollback(reason).finally(() => respondError(upstream, reason));
        } else {
            return transaction //
                .close()
                .then(relay(upstream))
                .catch(respondUpdateError(upstream));
        }
    };
}

function respondUpdateError(upstream: ServerResponse): (reason: any) => ModelUpdateResult {
    return reason => {
        respondError(upstream, reason);
        return { success: false };
    };
}
