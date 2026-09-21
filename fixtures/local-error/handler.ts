export class Handler {
  error(message: string): string {
    return message;
  }

  run(): void {
    console.error("fail");
    this.error("fail");
  }
}
