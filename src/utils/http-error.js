// 상태 코드와 "클라이언트에게 보여도 되는" 메시지를 가진 예외.
// Spring의 ResponseStatusException 과 비슷하다. error.middleware.js 가 통일된 JSON으로 바꾼다.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const badRequest = (msg = "잘못된 요청입니다.") => new HttpError(400, msg);
export const unauthorized = (msg = "인증이 필요합니다.") => new HttpError(401, msg);
export const notFound = (msg = "대상을 찾을 수 없습니다.") => new HttpError(404, msg);
export const forbidden = (msg = "허용되지 않은 요청입니다.") => new HttpError(403, msg);
