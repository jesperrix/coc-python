// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Terminal } from 'coc.nvim'
import { inject, injectable } from 'inversify'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import '../../common/extensions'
import { IServiceContainer } from '../../ioc/types'
import { ITerminalManager } from '../application/types'
import { IDisposableRegistry } from '../types'
import { ITerminalActivator, ITerminalHelper, ITerminalService, TerminalShellType } from './types'

@injectable()
export class TerminalService implements ITerminalService, Disposable {
  private terminal?: Terminal
  private terminalShellType!: TerminalShellType
  private terminalClosed = new Emitter<void>()
  private terminalManager: ITerminalManager
  private terminalHelper: ITerminalHelper
  private terminalActivator: ITerminalActivator
  public get onDidCloseTerminal(): Event<void> {
    return this.terminalClosed.event.bind(this.terminalClosed)
  }
  constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer,
    private resource?: Uri,
    private title = 'Python') {

    const disposableRegistry = this.serviceContainer.get<Disposable[]>(IDisposableRegistry)
    disposableRegistry.push(this)
    this.terminalHelper = this.serviceContainer.get<ITerminalHelper>(ITerminalHelper)
    this.terminalManager = this.serviceContainer.get<ITerminalManager>(ITerminalManager)
    this.terminalManager.onDidCloseTerminal(this.terminalCloseHandler, this, disposableRegistry)
    this.terminalActivator = this.serviceContainer.get<ITerminalActivator>(ITerminalActivator)
  }
  public dispose(): void {
    if (this.terminal) {
      this.terminal.dispose()
    }
  }
  public async sendCommand(command: string, args: string[]): Promise<void> {
    await this.ensureTerminal()
    const text = this.terminalHelper.buildCommandForTerminal(this.terminalShellType, command, args)
    this.terminal!.show(true)
    this.terminal!.sendText(text, true)
  }
  public async sendText(text: string): Promise<void> {
    await this.ensureTerminal()
    this.terminal!.show(true)
    this.terminal!.sendText(text)
  }
  public async show(preserveFocus = true): Promise<void> {
    await this.ensureTerminal(preserveFocus)
    this.terminal!.show(preserveFocus)
  }
  private async ensureTerminal(preserveFocus = true): Promise<void> {
    if (this.terminal) {
      return
    }
    const shellPath = this.terminalHelper.getTerminalShellPath()
    this.terminalShellType = !shellPath || shellPath.length === 0 ? TerminalShellType.other : this.terminalHelper.identifyTerminalShell(shellPath)
    this.terminal = await this.terminalManager.createTerminal({ name: this.title })
    await this.terminalActivator.activateEnvironmentInTerminal(this.terminal!, this.resource, preserveFocus)
    this.terminal!.show(preserveFocus)
    // this.sendTelemetry().ignoreErrors()
  }
  private terminalCloseHandler(terminal: Terminal): void {
    if (terminal === this.terminal) {
      this.terminalClosed.fire()
      this.terminal = undefined
    }
  }
}
