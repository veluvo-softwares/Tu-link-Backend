import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Priority } from '../../../types/priority.type';
import { LocationUpdate } from '../../../shared/interfaces/location.interface';
import { Journey } from '../../../shared/interfaces/journey.interface';
import { Participant } from '../../../shared/interfaces/participant.interface';
import { LocationHistory } from '../../../shared/interfaces/location.interface';
import { DistanceUtils } from '../../../common/utils/distance.utils';

@Injectable()
export class PriorityService {
  constructor(private configService: ConfigService) {}

  /**
   * Calculate priority for a location update using Uber-inspired logic
   */
  calculatePriority(
    update: LocationUpdate,
    journey: Journey,
    participant: Participant,
    lastLocation?: LocationHistory,
    leaderLocation?: LocationUpdate,
  ): Priority {
    // HIGH priority triggers

    // 1. Leader location updates (always HIGH)
    if (participant.role === 'LEADER') {
      return 'HIGH';
    }

    // 2. Lag alerts (distance from leader exceeds threshold)
    if (leaderLocation) {
      const lag = DistanceUtils.haversineDistance(
        update.location,
        leaderLocation.location,
      );
      if (lag > journey.lagThresholdMeters) {
        return 'HIGH';
      }
    }

    // 3. Journey status changes
    if (update.metadata?.statusChange) {
      return 'HIGH';
    }

    // MEDIUM priority triggers

    // 1. Significant movement (>50m from last update)
    if (lastLocation) {
      const lastLocationCoords = {
        latitude: lastLocation.location.latitude,
        longitude: lastLocation.location.longitude,
      };

      const distance = DistanceUtils.haversineDistance(
        lastLocationCoords,
        update.location,
      );
      if (distance > 50) {
        return 'MEDIUM';
      }
    }

    // 2. Significant speed changes (>10 km/h difference)
    if (this.hasSignificantSpeedChange(lastLocation, update)) {
      return 'MEDIUM';
    }

    // 3. Arrival detection (near destination)
    if (journey.destination) {
      const destinationCoords = {
        latitude: journey.destination.latitude,
        longitude: journey.destination.longitude,
      };

      const distanceToDestination = DistanceUtils.haversineDistance(
        update.location,
        destinationCoords,
      );

      const arrivalThreshold =
        this.configService.get<number>('app.arrivalDistanceThresholdMeters') ??
        100;

      if (distanceToDestination < arrivalThreshold) {
        return 'MEDIUM';
      }
    }

    // LOW priority (default for minor updates)
    return 'LOW';
  }

  /**
   * Determine if update should be throttled based on priority and timing
   */
  shouldThrottle(
    update: LocationUpdate,
    priority: Priority,
    lastUpdateTime: number | null,
  ): boolean {
    if (!lastUpdateTime) return false;

    const timeSinceLastUpdate = Date.now() - lastUpdateTime;

    switch (priority) {
      case 'HIGH':
        return false; // Never throttle HIGH priority
      case 'MEDIUM':
        return timeSinceLastUpdate < 3000; // 3 seconds
      case 'LOW':
        return timeSinceLastUpdate < 10000; // 10 seconds
    }
  }

  /**
   * Check if battery-aware throttling should be applied
   */
  shouldThrottleForBattery(
    update: LocationUpdate,
    priority: Priority,
  ): boolean {
    const batteryLevel = update.metadata?.batteryLevel;

    if (!batteryLevel) return false;

    // Aggressive throttling below 20%
    if (batteryLevel < 20) {
      return priority === 'LOW' || priority === 'MEDIUM';
    }

    // Moderate throttling below 50%
    if (batteryLevel < 50) {
      return priority === 'LOW';
    }

    return false;
  }

  /**
   * Check for significant speed changes
   */
  private hasSignificantSpeedChange(
    lastLocation?: LocationHistory,
    update?: LocationUpdate,
  ): boolean {
    if (!lastLocation || !update) return false;
    if (lastLocation.speed === undefined || update.speed === undefined)
      return false;

    const speedDiff = Math.abs(update.speed - lastLocation.speed);
    const speedDiffKmh = speedDiff * 3.6; // Convert m/s to km/h

    return speedDiffKmh > 10; // 10 km/h threshold
  }
}
