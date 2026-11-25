import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

// 잔디(활동 히트맵)용 활동 기록. 같은 회원이 같은 날 같은 대상(refId)에 대해 같은 종류의 활동은 1건만 저장된다.
// activityDate 는 KST 기준 'YYYY-MM-DD' 문자열, createdAt 은 UTC.
export const UserActivity = sequelize.define(
  "UserActivity",
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true }, // bigNumberStrings 때문에 문자열로 나온다
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      field: "user_id",
      references: { model: "users", key: "id" },
    },
    activityType: { type: DataTypes.STRING(30), allowNull: false, field: "activity_type" },
    refId: { type: DataTypes.STRING(64), allowNull: false, field: "ref_id" },
    activityDate: { type: DataTypes.DATEONLY, allowNull: false, field: "activity_date" },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  },
  { tableName: "user_activities" },
);
