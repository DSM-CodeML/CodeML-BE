import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

// 트레일의 챕터. ord 는 트레일 안 순서(화면의 "Ch n").
export const TrailChapter = sequelize.define(
  "TrailChapter",
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    trailId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "trail_id", references: { model: "trails", key: "id" } },
    ord: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    title: { type: DataTypes.STRING(100), allowNull: false },
  },
  { tableName: "trail_chapters" },
);
