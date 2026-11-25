-- 트레일(학습 경로): 트레일 > 챕터 > 레슨 > 단계(basic/practice/test) > 문제.
-- 문제 본문은 복제하지 않고 기존 problems 를 참조한다. 진행 상황은 submissions 로 계산하므로 저장하지 않는다.

CREATE TABLE trails (
  id      INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  ord     TINYINT UNSIGNED NOT NULL,
  eyebrow VARCHAR(100)     NOT NULL,
  title   VARCHAR(100)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trails_ord (ord)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE trail_chapters (
  id       INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  trail_id INT UNSIGNED     NOT NULL,
  ord      TINYINT UNSIGNED NOT NULL,
  title    VARCHAR(100)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trail_chapters_order (trail_id, ord),
  CONSTRAINT fk_trail_chapters_trail FOREIGN KEY (trail_id) REFERENCES trails (id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE trail_lessons (
  id         INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  chapter_id INT UNSIGNED     NOT NULL,
  ord        TINYINT UNSIGNED NOT NULL,
  title      VARCHAR(100)     NOT NULL,
  tag        VARCHAR(30)      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trail_lessons_order (chapter_id, ord),
  CONSTRAINT fk_trail_lessons_chapter FOREIGN KEY (chapter_id) REFERENCES trail_chapters (id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 레슨에 속한 문제. 같은 레슨에 같은 문제는 한 번만, 단계 안 순서(ord)는 겹치지 않는다.
CREATE TABLE trail_lesson_problems (
  lesson_id  INT UNSIGNED NOT NULL,
  problem_id INT UNSIGNED NOT NULL,
  step       ENUM('basic','practice','test') NOT NULL,
  ord        TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (lesson_id, problem_id),
  UNIQUE KEY uq_trail_lesson_problems_order (lesson_id, step, ord),
  KEY idx_trail_lesson_problems_problem (problem_id),
  CONSTRAINT fk_trail_lesson_problems_lesson FOREIGN KEY (lesson_id) REFERENCES trail_lessons (id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_trail_lesson_problems_problem FOREIGN KEY (problem_id) REFERENCES problems (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
