import { getMethod, getQuery, setHeader, type H3Event } from "h3";
import {
  getNexusStore,
  getNexusStoreRevision,
  storeHelpers,
} from "./domain-store";
import { readJsonBody } from "../utils/api-envelope";
import {
  getEffectiveScheduleEntriesForUser,
  isScheduleEntryInWeek,
} from "./schedule-calendar";
import { normalizeVisibilityScope } from "./social-collaboration-core";
import { handleLegacyAccountApi, isLegacyAccountPath } from "../modules/legacy/legacy-account-handler";
import { handleLegacyAiScheduleApi, isLegacyAiSchedulePath } from "../modules/legacy/legacy-ai-schedule-handler";
import { handleLegacyClawDBotApi, isLegacyClawDBotPath } from "../modules/legacy/legacy-clawdbot-handler";
import { handleLegacyCircleApi, isLegacyCirclePath } from "../modules/legacy/legacy-circle-handler";
import { handleLegacyCompanionApi, isLegacyCompanionPath } from "../modules/legacy/legacy-companion-handler";
import { handleLegacyFoodCampaignApi, isLegacyFoodCampaignPath } from "../modules/legacy/legacy-food-campaign-handler";
import { handleLegacyFoodCandidateApi, isLegacyFoodCandidatePath } from "../modules/legacy/legacy-food-candidate-handler";
import { handleLegacyNotificationApi, isLegacyNotificationPath } from "../modules/legacy/legacy-notification-handler";
import {
  appendLegacyAudit,
  createLegacyError,
  createLegacySession,
  extractExamDateFromText,
  registerLegacySession,
  resolveAbsoluteRequestUrl,
  resolveCloudflareEnv,
  resolveLegacyAuthContext,
  revokeLegacySession,
  toLegacyPath,
} from "../modules/legacy/legacy-runtime-utils";
import { handleLegacySocialActivityApi, isLegacySocialActivityPath } from "../modules/legacy/legacy-social-activity-handler";
import { handleLegacySocialRelationApi, isLegacySocialRelationPath } from "../modules/legacy/legacy-social-relation-handler";
import {
  blockSocialSubscriptionBetweenUsers,
  buildScheduleCandidateConflictPayload,
  buildSocialRelationStatusPayload,
  createSocialNotification,
  revokeSocialSubscriptionBetweenUsers,
  resolveViewerVisibilityScope,
  syncLegacySubscriptionTarget,
  upsertSocialSubscriptionEdge,
} from "../modules/legacy/legacy-social-utils";
import { getLegacyState } from "../modules/legacy/legacy-state";
import {
  createClawDBotUser,
  findClawDBotUser,
  findUserByStudentId,
  findUserByStudentNo,
  findUserByUserId,
  isAdminRole,
  resolveBoundTargetUser,
  resolveMeaningfulUserName,
  resolveNotificationRecipientUserIds,
  resolveSocialActorUser,
  resolveUserDisplayLabel,
  toLegacyAuthUser,
} from "../modules/legacy/legacy-user-utils";
import {
  handleLegacyUploadApi,
  isLegacyUploadPath,
  LEGACY_AVATAR_MAX_BYTES,
  LEGACY_WALLPAPER_MAX_BYTES,
  persistLegacyUserMediaUpload,
} from "../modules/legacy/legacy-upload-handler";

export const handleSocialV1Api = async (event: H3Event) => {
  const store = getNexusStore();
  const state = getLegacyState(store);
  const method = getMethod(event).toUpperCase();
  const query = getQuery(event) as Record<string, unknown>;
  const path = toLegacyPath(event);

  if (isLegacyAccountPath(path)) {
    const accountResponse = await handleLegacyAccountApi({
      event,
      method,
      path,
      query,
      store,
      state,
      toApiError: createLegacyError,
      readJsonBody,
      requireLegacyAuth: resolveLegacyAuthContext,
      createSession: createLegacySession,
      registerSession: registerLegacySession,
      revokeSession: revokeLegacySession,
      resolveBoundTargetUser: (targetStore, accountUser) => resolveBoundTargetUser(targetStore, state, accountUser),
      findUserByStudentId,
      findUserByStudentNo,
      isAdminRole,
      resolveViewerVisibilityScope,
      persistUserMediaUpload: (targetEvent, targetStore, targetUser, usage, maxBytes) =>
        persistLegacyUserMediaUpload(targetEvent, targetStore, targetUser, usage, maxBytes, createLegacyError),
      avatarMaxBytes: LEGACY_AVATAR_MAX_BYTES,
      wallpaperMaxBytes: LEGACY_WALLPAPER_MAX_BYTES,
    });
    if (accountResponse) {
      return accountResponse;
    }
  }

  if (isLegacyNotificationPath(path)) {
    const notificationResponse = await handleLegacyNotificationApi({
      event,
      method,
      path,
      query,
      store,
      getStoreRevision: getNexusStoreRevision,
      toApiError: createLegacyError,
      requireLegacyAuth: resolveLegacyAuthContext,
      resolveRecipientUserIds: (targetStore, user) => resolveNotificationRecipientUserIds(targetStore, state, user),
      nowIso: storeHelpers.nowIso,
    });
    if (notificationResponse) {
      return notificationResponse;
    }
  }

  if (isLegacySocialRelationPath(path)) {
    const socialRelationResponse = await handleLegacySocialRelationApi({
      event,
      method,
      path,
      query,
      store,
      state,
      getStoreRevision: getNexusStoreRevision,
      toApiError: createLegacyError,
      readJsonBody,
      requireLegacyAuth: resolveLegacyAuthContext,
      resolveSocialActorUser: (targetStore, accountUser) => resolveSocialActorUser(targetStore, state, accountUser),
      resolveRecipientUserIds: (targetStore, accountUser) => resolveNotificationRecipientUserIds(targetStore, state, accountUser),
      findUserByStudentId,
      isAdminRole,
      upsertSocialSubscriptionEdge: (targetStore, input) => upsertSocialSubscriptionEdge(targetStore, state, input),
      revokeSocialSubscriptionBetweenUsers: (targetStore, leftUser, rightUser, options) => revokeSocialSubscriptionBetweenUsers(targetStore, state, leftUser, rightUser, options),
      blockSocialSubscriptionBetweenUsers: (targetStore, leftUser, rightUser) => blockSocialSubscriptionBetweenUsers(targetStore, state, leftUser, rightUser),
      createSocialNotification,
    });
    if (socialRelationResponse) {
      return socialRelationResponse;
    }
  }

  if (isLegacyCirclePath(path)) {
    const circleResponse = await handleLegacyCircleApi({
      event,
      method,
      path,
      query,
      store,
      getStoreRevision: getNexusStoreRevision,
      toApiError: createLegacyError,
      readJsonBody,
      requireLegacyAuth: resolveLegacyAuthContext,
      resolveSocialActorUser: (targetStore, accountUser) => resolveSocialActorUser(targetStore, state, accountUser),
      normalizeVisibilityScope,
      upsertSocialSubscriptionEdge: (targetStore, input) => upsertSocialSubscriptionEdge(targetStore, state, input),
      syncLegacySubscriptionTarget: (targetStore, subscriberUserId, targetUser) => syncLegacySubscriptionTarget(targetStore, state, subscriberUserId, targetUser),
      createSocialNotification,
      resolveUserDisplayLabel,
    });
    if (circleResponse) {
      return circleResponse;
    }
  }

  if (isLegacySocialActivityPath(path)) {
    const activityResponse = await handleLegacySocialActivityApi({
      event,
      method,
      path,
      query,
      store,
      getStoreRevision: getNexusStoreRevision,
      toApiError: createLegacyError,
      readJsonBody,
      requireLegacyAuth: resolveLegacyAuthContext,
      resolveSocialActorUser: (targetStore, accountUser) => resolveSocialActorUser(targetStore, state, accountUser),
      findUserByUserId,
      findUserByStudentId,
      isAdminRole,
      resolveViewerVisibilityScope,
      buildSocialRelationStatusPayload,
      getEffectiveScheduleEntriesForUser,
      isScheduleEntryInWeek,
      setHeader,
      createSocialNotification,
    });
    if (activityResponse) {
      return activityResponse;
    }
  }

  if (isLegacyUploadPath(path)) {
    const uploadResponse = await handleLegacyUploadApi({
      event,
      method,
      path,
      store,
      toApiError: createLegacyError,
      requireLegacyAuth: resolveLegacyAuthContext,
      getStoreRevision: getNexusStoreRevision,
    });
    if (uploadResponse) {
      return uploadResponse;
    }
  }

  if (isLegacyFoodCandidatePath(path)) {
    const foodCandidateResponse = await handleLegacyFoodCandidateApi({
      event,
      method,
      path,
      query,
      store,
      state,
      toApiError: createLegacyError,
      readJsonBody,
      requireLegacyAuth: resolveLegacyAuthContext,
      resolveBoundTargetUser: (targetStore, accountUser) => resolveBoundTargetUser(targetStore, state, accountUser),
      isAdminRole,
    });
    if (foodCandidateResponse) {
      return foodCandidateResponse;
    }
  }

  if (isLegacyFoodCampaignPath(path)) {
    const foodCampaignResponse = await handleLegacyFoodCampaignApi({
      event,
      method,
      path,
      query,
      store,
      state,
      toApiError: createLegacyError,
      readJsonBody,
      requireLegacyAuth: resolveLegacyAuthContext,
      resolveBoundTargetUser: (targetStore, accountUser) => resolveBoundTargetUser(targetStore, state, accountUser),
      findUserByStudentId,
      isAdminRole,
      resolveUserDisplayLabel,
    });
    if (foodCampaignResponse) {
      return foodCampaignResponse;
    }
  }

  if (isLegacyAiSchedulePath(path)) {
    const aiScheduleResponse = await handleLegacyAiScheduleApi({
      event,
      method,
      path,
      store,
      getStoreRevision: getNexusStoreRevision,
      toApiError: createLegacyError,
      readJsonBody,
      requireLegacyAuth: resolveLegacyAuthContext,
      resolveEnv: resolveCloudflareEnv,
      resolveAbsoluteUrl: resolveAbsoluteRequestUrl,
      buildConflictPayload: buildScheduleCandidateConflictPayload,
      extractExamDate: extractExamDateFromText,
    });
    if (aiScheduleResponse) {
      return aiScheduleResponse;
    }
  }

  if (isLegacyClawDBotPath(path)) {
    const clawDBotResponse = await handleLegacyClawDBotApi({
      event,
      method,
      path,
      store,
      getStoreRevision: getNexusStoreRevision,
      toApiError: createLegacyError,
      readJsonBody,
      resolveEnv: resolveCloudflareEnv,
      findUserByStudentNo,
      findClawDBotUser,
      createClawDBotUser: (targetStore, studentNo, nickname) => createClawDBotUser(targetStore, state, studentNo, nickname),
      toLegacyAuthUser: (accountUser, boundTarget) => toLegacyAuthUser(accountUser, boundTarget, state),
      buildConflictPayload: buildScheduleCandidateConflictPayload,
      extractExamDate: extractExamDateFromText,
      appendAudit: appendLegacyAudit,
    });
    if (clawDBotResponse) {
      return clawDBotResponse;
    }
  }

  if (isLegacyCompanionPath(path)) {
    const companionResponse = await handleLegacyCompanionApi({
      event,
      method,
      path,
      query,
      store,
      getStoreRevision: getNexusStoreRevision,
      readJsonBody,
      requireLegacyAuth: resolveLegacyAuthContext,
      resolveSocialActorUser: (targetStore, accountUser) => resolveSocialActorUser(targetStore, state, accountUser),
      findUserByStudentId,
      findUserByUserId,
      resolveUserDisplayLabel,
      resolveMeaningfulUserName,
    });
    if (companionResponse) {
      return companionResponse;
    }
  }

  return null;
};
