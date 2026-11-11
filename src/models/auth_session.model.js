import { DataTypes } from "sequelize";
import { sequelize } from "../config/db.js";

export const AuthSession = sequelize.define(
  "AuthSession",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      field: "user_id",
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },

    createdAt: {
      type: DataTypes.DATE(3),
      field: "created_at",
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    expiresAt: {
      type: DataTypes.DATE(3),
      field: "expires_at",
      allowNull: false,
    },

    revokedAt: {
      type: DataTypes.DATE(3),
      field: "revoked_at",
      allowNull: true,
    },
  },
  {
    tableName: "auth_sessions",
    timestamps: false,
  },
);
