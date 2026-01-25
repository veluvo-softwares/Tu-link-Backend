import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../../../shared/firebase/firebase.service';
import { ParticipantService } from '../../journey/services/participant.service';
import { LocationUpdate } from '../../../shared/interfaces/location.interface';
import { Journey } from '../../../shared/interfaces/journey.interface';
import { DistanceUtils } from '../../../common/utils/distance.utils';
import { FieldValue, DocumentSnapshot } from 'firebase-admin/firestore';

interface ParticipantData {
  status: string;
  [key: string]: unknown;
}

@Injectable()
export class ArrivalDetectionService {
  constructor(
    private firebaseService: FirebaseService,
    private participantService: ParticipantService,
    private configService: ConfigService,
  ) {}

  /**
   * Detect if a participant has arrived at the destination
   */
  async detectArrival(
    update: LocationUpdate,
    journey: Journey,
  ): Promise<boolean> {
    if (!journey.destination) {
      return false;
    }

    const destinationCoords = {
      latitude: journey.destination.latitude,
      longitude: journey.destination.longitude,
    };

    const distanceToDestination = DistanceUtils.haversineDistance(
      update.location,
      destinationCoords,
    );

    const distanceThreshold =
      this.configService.get<number>('app.arrivalDistanceThresholdMeters') ??
      100;
    const speedThreshold =
      this.configService.get<number>('app.arrivalSpeedThresholdMps') ?? 1.39;

    // Consider arrived if:
    // 1. Within distance threshold (default 100 meters)
    // 2. Speed is low (< 5 km/h = 1.39 m/s) or speed not available
    const isWithinDistance = distanceToDestination < distanceThreshold;
    const isLowSpeed = !update.speed || update.speed < speedThreshold;

    if (isWithinDistance && isLowSpeed) {
      await this.markParticipantArrived(update.participantId, journey.id);
      return true;
    }

    return false;
  }

  /**
   * Mark a participant as arrived
   */
  private async markParticipantArrived(
    participantId: string,
    journeyId: string,
  ): Promise<void> {
    // Check if already marked as arrived
    const participantDoc = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .doc(participantId)
      .get();

    if (!participantDoc.exists) {
      return;
    }

    const participant = participantDoc.data() as ParticipantData | undefined;
    if (participant && participant.status === 'ARRIVED') {
      return; // Already marked as arrived
    }

    // Update participant status to ARRIVED
    await participantDoc.ref.update({
      status: 'ARRIVED',
      leftAt: FieldValue.serverTimestamp(),
    });
  }

  /**
   * Get all participants who have arrived
   */
  async getArrivedParticipants(journeyId: string): Promise<string[]> {
    const snapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .where('status', '==', 'ARRIVED')
      .get();

    return snapshot.docs.map((doc: DocumentSnapshot) => doc.id);
  }

  /**
   * Check if all participants have arrived
   */
  async allParticipantsArrived(journeyId: string): Promise<boolean> {
    const participantsSnapshot = await this.firebaseService.firestore
      .collection('journeys')
      .doc(journeyId)
      .collection('participants')
      .where('status', 'in', ['ACTIVE', 'ACCEPTED'])
      .get();

    return participantsSnapshot.empty;
  }
}
