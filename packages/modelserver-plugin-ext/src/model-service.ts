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

import { AnyObject, Diagnostic, Format, ModelServerCommand, ModelUpdateResult, TypeGuard } from '@eclipse-emfcloud/modelserver-client';
import { Operation } from 'fast-json-patch';
import * as URI from 'urijs';

export const ModelServiceFactory = Symbol('ModelServiceFactory');
export const ModelService = Symbol('ModelService');

/**
 * A factory that obtains the `ModelService` for a particular model URI.
 */
export type ModelServiceFactory = (modeluri: URI) => ModelService;

/**
 * A service that plug-in extensions may use to create, access, and modify a model.
 * Whereas it is not defined how much local caching of model state may be implemented
 * by this service, ranging from pure pass-through of requests to the back-end to a
 * complete in-memory replica of model content and edit state, all access to the
 * model should be performed through this service and not directly via a
 * `ModelServerClientApi` connection to the Java (EMF) Server.
 *
 * In effect, this service is a proxy for the remote _Model Server_ API of host server itself,
 * accessible in-process.
 */
export interface ModelService {
    /**
     * Query the URI of the model that I access.
     *
     * @returns my model's URI
     */
    getModelURI(): URI;

    /**
     * Get the content of my model. If the `format` is omitted and a request needs to be
     * sent to retrieve the model from the EMF server, then `json-v2` is implied.
     *
     * @param format the optional format of the request to send to the underlying Java (EMF) server in case the model needs to be retrieved from it
     * @returns the model content
     */
    getModel(format?: Format): Promise<AnyObject>;

    /**
     * Get the content of my model. If the `format` is omitted and a request needs to be
     * sent to retrieve the model from the EMF server, then `json-v2` is implied.
     *
     * @param typeGuard a type guard to coerce the model into the expected type
     * @param format the optional format of the request to send to the underlying Java (EMF) server in case the model needs to be retrieved from it
     * @returns the model content, if it conforms to the type guard
     */
    getModel<M>(typeGuard: TypeGuard<M>, format?: Format): Promise<M>;

    /**
     * Apply a JSON patch to edit my model, including side-effects such as triggers
     * contributed by plug-ins in the host server.
     *
     * _Note_ that if a {@link openTransaction transaction} is currently open on the given model,
     * then the `patch` is applied in the context of that transaction.
     *
     * @param patch the JSON patch to apply to the model
     * @returns the result of the model edit, including any consequent triggers, if applicable
     */
    edit(patch: Operation | Operation[]): Promise<ModelUpdateResult>;

    /**
     * Execute a command to edit my model, with support for custom commands implemented by
     * plug-ins in the host server.
     *
     * _Note_ that if a {@link openTransaction transaction} is currently open on the given model,
     * then the `command` is executed in the context of that transaction.
     *
     * @param command the command to execute on the model
     * @returns the result of the model edit, including any consequent triggers, if applicable
     */
    edit(command: ModelServerCommand): Promise<ModelUpdateResult>;

    /**
     * Undo the last change made to my model.
     *
     * @returns a description of the changes in the model induced by the undo
     */
    undo(): Promise<ModelUpdateResult>;

    /**
     * Redo the last change undone in my model.
     *
     * @returns a description of the changes in the model induced by the redo
     */
    redo(): Promise<ModelUpdateResult>;

    /**
     * Open a transaction for multiple sequential edits on my model to be collected into an
     * atomic unit of undo/redo. Unlike the underlying _Model Server_ protocol, these transactions
     * may be nested: if a transaction is already open on some model, a nested transaction may
     * be opened that commits into the context of the parent transaction. All changes performed
     * in the context of a top-level transaction are collected into an atomic change on the
     * undo stack.
     *
     * @returns the new transaction
     */
    openTransaction(): Promise<EditTransaction>;

    /**
     * Validate my model, including any custom validation rules contributed by plug-ins
     * in the host server.
     *
     * @returns the validation results
     */
    validate(): Promise<Diagnostic>;

    /**
     * Create my model in the underlying Java (EMF) model server.
     * If omitted, the `format` is implied to be `json-v2`.
     *
     * @param content the content of the model
     * @param format the optional format of the request to send to the underlying Java (EMF) server
     * @returns the created model content, or a rejected promise if the model already exists
     */
    create<M extends AnyObject>(content: M, format?: Format): Promise<M>;

    /**
     * Save my model's current state.
     *
     * @returns whether the save succeeded. If `true` then the latest model state is guaranteed to be persistent
     */
    save(): Promise<boolean>;

    /**
     * Close my model and forget any server state associated with it.
     *
     * @returns whether the close succeeded
     */
    close(): Promise<boolean>;

    /**
     * Delete my model from persistent storage and forget any server state associated with it.
     *
     * @returns whether the deletion succeeded. If `true` then the model state is guaranteed not to be persistent
     */
    delete(): Promise<boolean>;
}

/**
 * Protocol for the client-side context of an open transaction on a model URI.
 * While a transaction is open, {@link ModelService.edit} operations on the model
 * are collected in the transaction context for atomic undo/redo when eventually
 * it is committed.
 */
export interface EditTransaction {
    /**
     * Query the URI of the model that this transaction edits.
     */
    getModelURI(): string;

    /**
     * Query whether the transaction is currently open.
     */
    isOpen(): boolean;

    /**
     * Apply a JSON patch to edit the model, including side-effects such as triggers
     * contributed by plug-ins in the host server.
     *
     * @param patch the JSON patch to apply to the model
     * @returns the result of the model edit, including any consequent triggers, if applicable
     */
    edit(patch: Operation | Operation[]): Promise<ModelUpdateResult>;

    /**
     * Execute a command to edit the model, with support for custom commands implemented by
     * plug-ins in the host server.
     *
     * @param command the command to execute on the model
     * @returns the result of the model edit, including any consequent triggers, if applicable
     */
    edit(command: ModelServerCommand): Promise<ModelUpdateResult>;

    /**
     * Close the transaction, putting the compound of all commands executed within its span
     * onto the stack for undo/redo. If the transaction is nested in another transaction,
     * then its changes are committed into the nesting transaction, which remains open.
     *
     * @returns the aggregate result of changes performed during the transaction
     */
    commit(): Promise<ModelUpdateResult>;

    /**
     * Undo all changes performed during the transaction and discard them.
     * The transaction is closed.
     *
     * @param error the reason for the rollback
     * @returns a failed update result
     */
    rollback(error: any): Promise<ModelUpdateResult>;
}
