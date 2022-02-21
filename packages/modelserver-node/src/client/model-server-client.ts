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
    Diagnostic,
    Format,
    MessageDataMapper,
    MessageType,
    Model,
    ModelServerClientV2,
    ModelServerCommand,
    ModelServerMessage,
    ModelServerNotification,
    ModelUpdateResult,
    Operations,
    ServerConfiguration,
    SubscriptionListener,
    SubscriptionOptions,
    TypeGuard
} from '@eclipse-emfcloud/modelserver-client';
import { Executor, Logger, ModelServerClientApi, Transaction } from '@eclipse-emfcloud/modelserver-plugin-ext';
import axios from 'axios';
import { Operation } from 'fast-json-patch';
import { inject, injectable, named } from 'inversify';
import { v4 as uuid } from 'uuid';
import * as WebSocket from 'ws';

import { CommandProviderRegistry } from '../command-provider-registry';
import { TriggerProviderRegistry } from '../trigger-provider-registry';
import { WebSocketMessageAcceptor } from './web-socket-utils';

export const UpstreamConnectionConfig = Symbol('UpstreamConnectionConfig');

/**
 * Configuration of the connection to the _Upstream Model Server_.
 */
export interface UpstreamConnectionConfig {
    hostname: string;
    serverPort: number;
    baseURL: string;
}

export const InternalModelServerClientApi = Symbol('InternalModelServerClientApi');

/**
 * Private client API for the new endpoints in the _Model Server_ v2 API that are internal to
 * the _Model Server_.
 */
export interface InternalModelServerClientApi extends ModelServerClientApi {
    /**
     * Initialize me to communicate with the _Upstream Model Server_.
     */
    initialize(): void | Promise<void>;

    /**
     * Open a transactional self-compounding command/patch execution context on a model.
     *
     * @param modeluri the URI of the model on which to open the transaction
     * @returns a transactional context in which to execute a chained sequence of commands
     */
    openTransaction(modeluri: string): Promise<TransactionContext>;
}

/**
 * Protocol for the client-side context of an open transaction on a model URI.
 */
export interface TransactionContext extends Executor {
    /**
     * Close the transaction, putting the compound of all commands executed within its span
     * onto the stack for undo/redo.
     *
     * @returns the aggregate result of changes performed during the transaction
     */
    close(): Promise<ModelUpdateResult>;

    /**
     * Undo all changes performed during the transaction and discard them.
     *
     * @param error the reason for the rollback
     * @returns a failed update result
     */
    rollback(error: any): Promise<ModelUpdateResult>;
}

/**
 * Protocol of messages sent to and received from the _Model Server_ on a transaction socket.
 */
export interface ModelServerTransactionMessage<T = unknown> extends ModelServerMessage<T>, ModelServerNotification {
    type: 'execute' | 'close' | 'roll-back' | 'incrementalUpdate' | 'success';
}

export type MessageBody = ModelServerTransactionMessage;

/**
 * Definition of the response body for the `POST` request on the `transaction` endpoint.
 */
interface CreateTransactionResponseBody {
    data: {
        /**
         * The URI of the new transaction. This is the URI to connect a websocket to for messaging
         * command execution and receipt of private incremental updates.
         */
        uri: string;
    };
}

/** Use the v2 JSON format by default. */
const DEFAULT_FORMAT = 'json-v2';

/**
 * The kind of message payload for the `execute` message type.
 */
export type ExecuteMessageBody = ExecuteCommand | ExecutePatch;

/** A command payload. */
export interface ExecuteCommand {
    type: 'modelserver.emfcommand';
    data: ModelServerCommand;
}

/** A JSON Patch payload. */
export interface ExecutePatch {
    type: 'modelserver.patch';
    data: Operation | Operation[];
}

export namespace ExecuteMessageBody {
    /** Is an `object` an `ExecuteCommand`? */
    export function isCommand(object: any): object is ExecuteCommand {
        return 'type' in object && object.type === 'modelserver.emfcommand';
    }

    /** Is an `object` an `ExecutePatch`? */
    export function isPatch(object: any): object is ExecutePatch {
        return 'type' in object && object.type === 'modelserver.patch';
    }
}

/**
 * Default implementation of the version 2 client API for the _Model Server_ (a.k.a. _Upstream Model Server_).
 */
@injectable()
export class InternalModelServerClient implements InternalModelServerClientApi {
    @inject(Logger)
    @named(InternalModelServerClient.name)
    protected readonly logger: Logger;

    @inject(CommandProviderRegistry)
    protected readonly commandProviderRegistry: CommandProviderRegistry;

    @inject(TriggerProviderRegistry)
    protected readonly triggerProviderRegistry: TriggerProviderRegistry;

    @inject(UpstreamConnectionConfig)
    protected readonly upstreamConnectionConfig: UpstreamConnectionConfig;

    protected readonly transactions: Map<string, TransactionContext> = new Map();

    protected readonly delegate: ModelServerClientApi = new ModelServerClientV2();

    protected _baseURL: string;

    initialize(): void | Promise<void> {
        const basePath = this.upstreamConnectionConfig.baseURL.replace(/^\/+/, '');
        this._baseURL = `http://${this.upstreamConnectionConfig.hostname}:${this.upstreamConnectionConfig.serverPort}/${basePath}`;
        return this.delegate.initialize(this._baseURL, DEFAULT_FORMAT);
    }

    async openTransaction(modelURI: string): Promise<TransactionContext> {
        const clientID = uuid();

        return axios.post(this.makeURL('transaction', { modeluri: modelURI }), { data: clientID }).then(response => {
            const { uri: transactionURI } = (response.data as CreateTransactionResponseBody).data;
            const result = new DefaultTransactionContext(
                transactionURI,
                modelURI,
                this.commandProviderRegistry,
                this.triggerProviderRegistry,
                this.logger
            );
            return result.open(tc => this.closeTransaction(modelURI, tc));
        });
    }

    private closeTransaction(modelURI: string, tc: TransactionContext): void {
        if (this.transactions.get(modelURI) === tc) {
            this.transactions.delete(modelURI);
        }
    }

    protected makeURL(path: string, queryParameters?: any): string {
        const pathToAppend = path.replace(/^\/+/, ''); // Strip any leading slashes

        if (queryParameters) {
            const encodedParams = Object.entries(queryParameters)
                .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value.toString()))
                .join('&');
            return `${this._baseURL}${pathToAppend}?${encodedParams}`;
        }
        return `${this._baseURL}${pathToAppend}`;
    }

    //
    // API Delegation
    //

    getAll(): Promise<Model<unknown>[]>;
    getAll<M>(typeGuard: TypeGuard<M>): Promise<Model<M>[]>;
    getAll(format: Format): Promise<Model<string>[]>;
    getAll<M>(format?: Format | TypeGuard<M>): Promise<Model<unknown>[] | Model<M>[] | string[]> {
        if (typeof format === 'string') {
            return this.delegate.getAll(format);
        }
        return this.delegate.getAll(format);
    }
    get(modeluri: string, format?: Format): Promise<AnyObject>;
    get<M>(modeluri: string, typeGuard: TypeGuard<M>, format?: Format): Promise<M>;
    get<M>(modeluri: string, typeGuard?: Format | TypeGuard<M>, format?: Format): Promise<AnyObject | M> {
        if (!typeGuard) {
            return this.delegate.get(modeluri, format);
        }
        if (typeof typeGuard === 'string') {
            return this.delegate.get(modeluri, typeGuard);
        }
        return this.delegate.get(modeluri, typeGuard);
    }
    getModelUris(): Promise<string[]> {
        return this.delegate.getModelUris();
    }
    getElementById(modeluri: string, elementid: string, format?: Format): Promise<AnyObject>;
    getElementById<M>(modeluri: string, elementid: string, typeGuard: TypeGuard<M>): Promise<M>;
    getElementById<M>(modeluri: string, elementid: string, typeGuard?: Format | TypeGuard<M>, format?: Format): Promise<AnyObject | M> {
        if (!typeGuard) {
            return this.delegate.getElementById(modeluri, elementid, format);
        }
        if (typeof typeGuard === 'string') {
            return this.delegate.getElementById(modeluri, elementid, typeGuard);
        }
        return this.delegate.getElementById(modeluri, elementid, typeGuard, format);
    }
    getElementByName(modeluri: string, elementname: string, format?: Format): Promise<AnyObject>;
    getElementByName<M>(modeluri: string, elementname: string, typeGuard: TypeGuard<M>): Promise<M>;
    getElementByName<M>(modeluri: string, elementname: string, typeGuard?: Format | TypeGuard<M>, format?: Format): Promise<AnyObject | M> {
        if (!typeGuard) {
            return this.delegate.getElementByName(modeluri, elementname, format);
        }
        if (typeof typeGuard === 'string') {
            return this.delegate.getElementByName(modeluri, elementname, typeGuard);
        }
        return this.delegate.getElementByName(modeluri, elementname, typeGuard, format);
    }
    delete(modeluri: string): Promise<boolean> {
        return this.delegate.delete(modeluri);
    }
    close(modeluri: string): Promise<boolean> {
        return this.delegate.close(modeluri);
    }
    create(modeluri: string, model: string | AnyObject, format?: Format): Promise<AnyObject>;
    create<M>(modeluri: string, model: string | AnyObject, typeGuard: TypeGuard<M>, format?: Format): Promise<M>;
    create<M>(modeluri: string, model: string, typeGuard?: Format | TypeGuard<M>, format?: Format): Promise<AnyObject | M> {
        if (!typeGuard) {
            return this.delegate.create(modeluri, model, format);
        }
        if (typeof typeGuard === 'string') {
            return this.delegate.create(modeluri, model, typeGuard);
        }
        return this.delegate.create(modeluri, model, typeGuard, format);
    }
    update(modeluri: string, model: AnyObject | string, format?: Format): Promise<AnyObject>;
    update<M>(modeluri: string, model: AnyObject | string, typeGuard: TypeGuard<M>, format?: Format): Promise<M>;
    update<M>(modeluri: string, model: AnyObject | string, typeGuard?: Format | TypeGuard<M>, format?: Format): Promise<AnyObject | M> {
        if (!typeGuard) {
            return this.delegate.update(modeluri, model, format);
        }
        if (typeof typeGuard === 'string') {
            return this.delegate.update(modeluri, model, typeGuard);
        }
        return this.delegate.update(modeluri, model, typeGuard, format);
    }
    save(modeluri: string): Promise<boolean> {
        return this.delegate.save(modeluri);
    }
    saveAll(): Promise<boolean> {
        return this.delegate.saveAll();
    }
    validate(modeluri: string): Promise<Diagnostic> {
        return this.delegate.validate(modeluri);
    }
    getValidationConstraints(modeluri: string): Promise<string> {
        return this.delegate.getValidationConstraints(modeluri);
    }
    getTypeSchema(modeluri: string): Promise<string> {
        return this.delegate.getTypeSchema(modeluri);
    }
    getUiSchema(schemaname: string): Promise<string> {
        return this.delegate.getUiSchema(schemaname);
    }
    configureServer(configuration: ServerConfiguration): Promise<boolean> {
        return this.delegate.configureServer(configuration);
    }
    ping(): Promise<boolean> {
        return this.delegate.ping();
    }
    edit(modeluri: string, patch: Operation | Operation[], format?: Format): Promise<ModelUpdateResult>;
    edit(modeluri: string, command: ModelServerCommand, format?: Format): Promise<ModelUpdateResult>;
    edit(modeluri: string, patchOrCommand: Operation | Operation[] | ModelServerCommand): Promise<ModelUpdateResult> {
        if (patchOrCommand instanceof ModelServerCommand) {
            return this.delegate.edit(modeluri, patchOrCommand);
        }
        if (Array.isArray(patchOrCommand)) {
            return this.delegate.edit(modeluri, patchOrCommand);
        }
        return this.delegate.edit(modeluri, patchOrCommand);
    }
    undo(modeluri: string): Promise<ModelUpdateResult> {
        return this.delegate.undo(modeluri);
    }
    redo(modeluri: string): Promise<ModelUpdateResult> {
        return this.delegate.redo(modeluri);
    }
    subscribe(modeluri: string, listener: SubscriptionListener, options?: SubscriptionOptions): SubscriptionListener {
        return this.delegate.subscribe(modeluri, listener, options);
    }
    send(modelUri: string, message: ModelServerMessage<unknown>): void {
        return this.delegate.send(modelUri, message);
    }
    unsubscribe(modelUri: string): void {
        return this.delegate.unsubscribe(modelUri);
    }
}

/**
 * A context tracking the state of transactions while nested transactions are in progress.
 * Edit transactions for custom commands and triggers can be recursive: custom command transactions can execute
 * other custom commands and trigger patches can trigger further updates.
 * The `NestedEditContext` tracks the state of a parent transaction while a child transaction is in progress
 * so that when the child completes, its state can be appended to the parent state.
 * If a child transaction fails, its state is discarded.
 */
interface NestedEditContext {
    /** The aggregate of edits reported so far on the model by the upstream _Model Server_. */
    aggregatedUpdateResult: ModelUpdateResult;
}

/**
 * Default implementation of the client-side transaction context with socket message handling.
 */
class DefaultTransactionContext implements TransactionContext {
    private closeCallback: (tc: TransactionContext) => void;

    private socket: WebSocket;

    private nestedContexts: NestedEditContext[] = [];

    constructor(
        protected readonly transactionURI: string,
        protected readonly modelURI: string,
        protected readonly commandProviderRegistry: CommandProviderRegistry,
        protected readonly triggerProviderRegistry: TriggerProviderRegistry,
        protected readonly logger: Logger
    ) {
        // Ensure that asynchronous functions don't lose their 'this' context
        this.open = this.open.bind(this);
        this.execute = this.execute.bind(this);
        this.close = this.close.bind(this);
        this.rollback = this.rollback.bind(this);
    }

    /**
     * Open a new transaction on the upstream _Model Server_.
     *
     * @param closeCallback a call-back to invoke when the transaction is closed, for example to clean up associated bookkeeping
     * @returns a new transaction context
     */
    open(closeCallback: (tc: TransactionContext) => void): Promise<TransactionContext> {
        const result: Promise<TransactionContext> = new Promise((resolve, reject) => {
            this.closeCallback = closeCallback;

            const wsURI = new URL(this.transactionURI);
            wsURI.protocol = 'ws';
            const socket = new WebSocket(wsURI.toString());

            socket.onclose = event => {
                this.closeCallback.apply(this);
                this.socket = undefined;
            };
            socket.onopen = event => {
                this.socket = socket;
                resolve(this);
            };
            socket.onmessage = event => {
                this.logger.debug(`Message: ${event.data}`);
            };
            socket.onerror = event => {
                this.logger.error(`Socket error in ${wsURI}:\n`, event.error);
                reject(event.error);
            };

            this.pushNestedContext();
        });

        return result;
    }

    // Doc inherited from `Executor` interface
    async applyPatch(patch: Operation | Operation[]): Promise<ModelUpdateResult> {
        if (!this.socket) {
            return Promise.reject('Socket is closed.');
        }

        return this.sendPatch(patch);
    }

    private async sendPatch(patch: Operation | Operation[]): Promise<ModelUpdateResult> {
        return this.sendExecuteMessage({
            type: 'modelserver.patch',
            data: patch
        });
    }

    // Doc inherited from `Executor` interface
    async execute(command: ModelServerCommand): Promise<ModelUpdateResult> {
        if (!this.socket) {
            return Promise.reject('Socket is closed.');
        }

        // Hook in command-provider plug-ins
        if (!this.commandProviderRegistry.hasProvider(command.type)) {
            // Not handled. Send along to the Model Server
            return this.sendCommand(command);
        } else {
            this.logger.debug(`Getting commands provided recursively for ${command.type}`);

            const provided = await this.commandProviderRegistry.getCommands(command);
            if (typeof provided === 'function') {
                // It's a transaction function. We already have a transaction context (this one)
                this.pushNestedContext();
                const success = await provided(this);
                if (!success) {
                    this.popNestedContext(); // These changes were rolled back
                    return Promise.reject('Command execution failed.');
                }
                return this.popNestedContext();
            } else {
                // It's a substitute command or patch. Just pass it on in the usual way
                if (ModelServerCommand.is(provided)) {
                    return this.sendCommand(provided);
                }
                return this.sendPatch(provided);
            }
        }
    }

    private async sendCommand(command: ModelServerCommand): Promise<ModelUpdateResult> {
        return this.sendExecuteMessage({
            type: 'modelserver.emfcommand',
            data: command
        });
    }

    private sendExecuteMessage(body: ExecuteMessageBody): Promise<ModelUpdateResult> {
        if (!this.socket) {
            return Promise.reject('Socket is closed.');
        }

        const { aggregatedUpdateResult: current } = this.peekNestedContext();
        const result = WebSocketMessageAcceptor.promise<ModelUpdateResult>(this.socket, message => {
            const matched = message.type === 'success' && Operations.isPatch(message.data.patch);
            if (matched && current) {
                this.mergeModelUpdateResult(current, message.data);
            }
            return matched;
        });

        this.socket.send(JSON.stringify(this.message('execute', body)));

        return result;
    }

    /**
     * Push a nested execution context to collect execution results from nested command execution.
     *
     * @returns whether this was the (first) topmost nested context being pushed
     */
    private pushNestedContext(): boolean {
        const resultMessage = { type: MessageType.success, data: { patch: [] } };
        const aggregatedUpdateResult: ModelUpdateResult = MessageDataMapper.patchModel(resultMessage);
        return this.nestedContexts.push({ aggregatedUpdateResult }) === 1;
    }

    /**
     * Get the deepest (current) nested execution context on the stack.
     *
     * @returns the current nested execution context
     */
    private peekNestedContext(): NestedEditContext | undefined {
        if (this.nestedContexts.length) {
            return this.nestedContexts[this.nestedContexts.length - 1];
        }
        return undefined;
    }

    /**
     * Pop the deepest (current) nested execution context from the stack.
     * Its changes are aggregated onto the nest context up the stack, if any, to "commit" them into the current transaction.
     *
     * @returns the popped nested execution context
     */
    private popNestedContext(): ModelUpdateResult {
        const { aggregatedUpdateResult: result } = this.nestedContexts.pop();
        const currentContext = this.peekNestedContext();
        if (currentContext) {
            this.mergeModelUpdateResult(currentContext.aggregatedUpdateResult, result);
        }
        return result;
    }

    /**
     * Merge an additional model update result into a destination aggregation results.
     *
     * @param dst the model update result into which to merge an additional result
     * @param src an addition model update result, if any, to merge into the destination
     */
    private mergeModelUpdateResult(dst: ModelUpdateResult, src?: ModelUpdateResult): void {
        if (src?.patch && src.patch.length) {
            dst.patch = (dst.patch ?? []).concat(src.patch);
        }
    }

    // Doc inherited from `TransactionContext` interface
    async close(): Promise<ModelUpdateResult> {
        const updateResult = this.popNestedContext();

        if (!this.socket) {
            return transactionClosed;
        }

        let modelDelta = updateResult.patch;
        while (modelDelta && modelDelta.length) {
            const triggers = await this.triggerProviderRegistry.getTriggers(this.modelURI, modelDelta);
            if (triggers) {
                const triggerResult = await this.performTriggers(triggers);
                this.mergeModelUpdateResult(updateResult, triggerResult);
                modelDelta = triggerResult.patch;
            }
        }

        this.socket.send(JSON.stringify(this.message('close')));
        return updateResult;
    }

    // Doc inherited from `TransactionContext` interface
    async rollback(error: any): Promise<ModelUpdateResult> {
        if (this.socket) {
            this.socket.send(JSON.stringify(this.message('roll-back', { error })));
        }
        return transactionClosed;
    }

    /**
     * Perform `triggers` to update the model in consequence of changes that have been performed
     * by the transaction context that we are closing.
     *
     * @param triggers the triggers to apply to the model
     * @returns a new model update result describing the changes performed by the `triggers`
     */
    async performTriggers(triggers: Operation[] | Transaction): Promise<ModelUpdateResult> {
        // Start a nested transaction context
        this.pushNestedContext();

        if (typeof triggers === 'function') {
            await triggers(this);
        } else {
            await this.applyPatch(triggers);
        }

        return this.popNestedContext();
    }

    /**
     * Assemble a message to send to the upstream _Model Server_.
     *
     * @param type the message type
     * @param data the payload of the message
     * @returns the message body
     */
    protected message(type: MessageBody['type'], data: unknown = {}): MessageBody {
        return {
            type,
            modelUri: this.modelURI,
            data
        };
    }
}

// A model update result indicating that the transaction was already closed or was rolled back
const transactionClosed: ModelUpdateResult = { success: false };
