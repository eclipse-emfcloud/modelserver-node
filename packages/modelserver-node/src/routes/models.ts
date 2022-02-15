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
    AnyObject,
    CompoundCommand,
    encode,
    ModelServerCommand,
    ModelServerObject,
    ModelUpdateResult
} from '@eclipse-emfcloud/modelserver-client';
import { Logger } from '@eclipse-emfcloud/modelserver-plugin-ext';
import { Request, RequestHandler, Response } from 'express';
import { ServerResponse } from 'http';
import { inject, injectable, named } from 'inversify';

import { ExecuteMessageBody, InternalModelServerClientApi, TransactionContext } from '../client/model-server-client';
import { CommandProviderRegistry } from '../command-provider-registry';
import { ValidationManager } from '../services/validation-manager';
import { handleError, relay, respondError, RouteProvider, RouterFactory, validateFormat } from './routes';

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
 * Custom routing of requests on the `/api/v2/{undo,redo}` endpoints.
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
                // Just pass JSON patches through. There's nothing to interpret.
                this.modelServerClient
                    .edit(modelURI, message.data)
                    .then(this.performPatchValidation(modelURI))
                    .then(relay(res))
                    .catch(handleError(res));
            }

            const command = asModelServerCommand(message?.data);
            if (!command) {
                handleError(res)('Request body is not a ModelServerCommand.');
                return;
            }

            this.logger.debug(`Getting commands provided for ${command.type}`);

            const provided = await this.commandProviderRegistry.getCommands(command);
            if (typeof provided === 'function') {
                // It's a transaction function
                this.modelServerClient
                    .openTransaction(modelURI)
                    .then(ctx =>
                        provided(ctx)
                            .then(completeTransaction(ctx, res))
                            .then(this.performPatchValidation(modelURI))
                            .catch(error => ctx.rollback(error).finally(() => respondError(res, error)))
                    )
                    .catch(handleError(res));
            } else {
                // It's a substitute command. Just execute it in the usual way
                this.modelServerClient
                    .edit(modelURI, provided)
                    .then(this.performPatchValidation(modelURI))
                    .then(relay(res))
                    .catch(handleError(res));
            }
        };
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
            this.logger.debug('Not validating the failed command.');
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
 * Ensure that a custom command parsed from incoming JSON is a proper instance of the
 * {@link ModelServerCommand} or {@link CompoundCommand} class. Note that custom commands
 * cannot be of any other command API class because they all have known types that we do not intercept.
 * This ensures that, for example, methods of the `ModelServerCommand` class are available on
 * the command object.
 *
 * @param customCommand a custom command
 * @returns the custom command as a proper instance of the {@link ModelServerCommand} class
 */
function asModelServerCommand(customCommand: any): ModelServerCommand | undefined {
    if (customCommand) {
        // The client uses json-v2 format exclusively for commands/patches
        customCommand = encode('json')(customCommand);
    }

    if (isModelServerCommand(customCommand) && !(customCommand instanceof ModelServerCommand)) {
        Object.setPrototypeOf(customCommand, ModelServerCommand.prototype);
        return customCommand as ModelServerCommand;
    }
    if (isCompoundCommand(customCommand) && !(customCommand instanceof CompoundCommand)) {
        Object.setPrototypeOf(customCommand, CompoundCommand.prototype);
        return customCommand as CompoundCommand;
    }

    return undefined;
}

function isModelServerCommand(object: any): object is ModelServerCommand {
    return ModelServerObject.is(object) && object.eClass === ModelServerCommand.URI;
}

function isCompoundCommand(object: any): object is CompoundCommand {
    // The CompoundCommand.is(...) function is too specific, not recognizing custom types
    return ModelServerObject.is(object) && object.eClass === CompoundCommand.URI;
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
