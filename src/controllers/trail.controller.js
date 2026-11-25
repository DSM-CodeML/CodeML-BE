// HTTP 요청/응답 담당. 업무 로직은 trail.service.js 에 위임한다. (requireAuth 뒤에서 실행)
import { getTrail } from "../services/trail.service.js";

// GET /api/trail
export async function trail(req, res) {
  res.json(await getTrail(req.auth.userId));
}
